# WhatsApp Desktop (macOS) database notes

Reverse-engineering notes for the native macOS WhatsApp app's databases. They were verified in
October 2026 against a real `ChatStorage.sqlite`, using row counts, column usage,
protobuf decoding and cross-checks with `CallHistory.sqlite`. WhatsApp can change any of this
without notice; where a meaning is inferred rather than confirmed, it says so.

All files live in
`~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/` and are Core Data stores in WAL
mode. Timestamps are Core Data seconds (add `978307200` for Unix time), except values inside
protobuf blobs, which are Unix milliseconds.

| File | Used for |
|------|----------|
| `ChatStorage.sqlite` | Chats, messages, media metadata, push names |
| `ContactsV2.sqlite` | Address book: `ZWAADDRESSBOOKCONTACT` (`ZFULLNAME`, `ZLID`, `ZWHATSAPPID`, phone numbers) |
| `LID.sqlite` | `ZWAZACCOUNT`: `ZIDENTIFIER` (`…@lid`) → `ZPHONENUMBER` (digits), `ZDISPLAYNAME` |
| `CallHistory.sqlite` | Call log (used only to verify the call fields below) |
| `Message/` | Downloaded media; `ZWAMEDIAITEM.ZMEDIALOCALPATH` is relative to this folder |

## `ZWAMESSAGE.ZMESSAGETYPE`

| Value | Meaning | Where the content is |
|-------|---------|----------------------|
| 0 | text | `ZTEXT` |
| 1 | image | caption in `ZWAMEDIAITEM.ZTITLE` |
| 2 | video | caption in `ZTITLE` |
| 3 | audio / voice note | `ZMOVIEDURATION` = seconds |
| 4 | contact card | `ZVCARDNAME`, `ZVCARDSTRING` |
| 5 | location | `ZLATITUDE`, `ZLONGITUDE` |
| 6 | group event (join/leave/subject…) | `ZTEXT` is often a member JID |
| 7 | text with link preview | `ZTEXT` = message; `ZMEDIAURL` = link; `ZTITLE` = preview title |
| 8 | document | **`ZTEXT` = document title, `ZTITLE` = caption** |
| 10 | per-chat system notice | e.g. the E2E-encryption banner inserted as a chat's first row (`ZSORT = 1`, same timestamp as the first real message) |
| 11 | GIF | caption in `ZTITLE` |
| 14 | deleted message | `ZTITLE` = stanza ID of the revoked original |
| 15 | sticker | |
| 19 | WhatsApp Business template | `ZMETADATA` field 24.1: 2 = header, 6 = body, 7 = footer |
| 23 | WhatsApp PSA (video + text) | same layout as 19 |
| 27 | group invite link | |
| 30, 32 | business interactive (list/buttons) | 30: `ZMETADATA` 43.1.2 = body, 43.1.5.2[].1 = options |
| 31, 34 | list / button response | `ZTEXT` |
| 42, 43 | business template variants | `ZTEXT` |
| 46 | poll | `ZWAMESSAGEINFO.ZRECEIPTINFO` field 8 (below) |
| 54 | video note (round video) | |
| 59 | voice/video call event | `ZMETADATA` field 87 (below) |
| 66 | album header | the album's images follow as separate type-1 rows |
| 12, 13, 28, 60, 75 | unidentified | rare; no user-visible content found |

`ZGROUPEVENTTYPE` is not a reliable subtype outside group events: ordinary messages commonly
carry `2`.

## `ZWAMEDIAITEM`

- Almost every message has a `ZWAMEDIAITEM` row, including text messages. Many rows only hold
  `ZMETADATA`. So a media row does not mean there is a file: check the type and
  `ZMEDIALOCALPATH` / `ZMEDIAURL`.
- `ZMEDIALOCALPATH IS NULL` with a `ZMEDIAURL` means the attachment has not been downloaded to
  this Mac. This is common for images. The URL points at WhatsApp's
  encrypted CDN and needs `ZMEDIAKEY` to decrypt; this project deliberately does not fetch it.

## `ZWAMEDIAITEM.ZMETADATA` (protobuf)

| Field | Meaning |
|-------|---------|
| 5 | Quoted message's `ZSTANZAID` (**replies**) |
| 6 | Quoted message's sender JID |
| 7 | Quoted message's chat JID, only when it is in another chat ("reply privately" to a group message: 40 of 3,258 replies, all in 1:1 chats, all pointing at a group) |
| 19.1 | Snapshot of the quoted text |
| 24.1 | Template message: 2 header, 6 body, 7 footer |
| 43.1 | Interactive message: 2 body, 5.2[].1 option labels |
| 87.1 | Call: 1 = video flag, 2 = outcome, 3 = duration (s), 5.1 = caller JID |

Call outcome (87.1.2), compared against `CallHistory.sqlite`:

| Code | Meaning |
|------|---------|
| 0 | answered (always has a duration) |
| 1 | missed (incoming) / not answered (outgoing) |
| 3 | rejected (inferred) |
| 4 | answered on another device (inferred; call history shows it as not missed) |
| 6 | failed (inferred) |

**`ZPARENTMESSAGE` is not the reply link.** It is set on only a handful of rows, mostly group
events pointing at another message (their exact meaning is unconfirmed). Join replies via field 5 →
`ZWAMESSAGE.ZSTANZAID` (indexed), within the same `ZCHATSESSION`, or within the chat whose
`ZCONTACTJID` is field 7 when that is set.

**`ZSTANZAID` is unique per chat, not globally.** Call events (type 59) reuse the call ID in each
chat the call touched. In the audited DB every row had a non-empty stanza ID; 3 IDs appeared in
two chats, and 1 appeared twice in one chat (a duplicated row with identical date, sender and
text). The stable message key is `ZCONTACTJID` + `ZSTANZAID`.

## `ZWAMESSAGEINFO.ZRECEIPTINFO` (protobuf, joined via `ZWAMESSAGE.ZMESSAGEINFO`)

**Reactions** are stored on the message being reacted to, never as rows of their own:

| Field | Meaning |
|-------|---------|
| 7.1[] | one entry per reaction: 1 = reaction ID, 2 = reactor JID (**absent for your own reactions**), 3 = emoji (empty = removed), 4 = Unix ms |

**Polls** (type 46):

| Field | Meaning |
|-------|---------|
| 8.2 | question |
| 8.3[].1 | option labels |
| 8.4 | max selectable options |
| 8.5[] | votes: 1 = selected option index(es; absent = vote cleared), 4 = voter JID |

## Names

- `ZWAMESSAGE.ZPUSHNAME` is **not a name**. It is a base64-encoded protobuf blob (e.g. `IAA=`),
  and must never be shown as a sender.
- Senders: in groups `ZWAMESSAGE.ZGROUPMEMBER` → `ZWAGROUPMEMBER.ZMEMBERJID` (`ZFROMJID` is the
  group JID there). In 1:1 chats the sender is the chat's `ZWACHATSESSION.ZCONTACTJID`.
- Most group members are `…@lid` (privacy IDs). Resolve them through, in order: the address book
  (`ContactsV2.ZLID` / `ZWHATSAPPID`), `ZWAPROFILEPUSHNAME.ZJID` (also under the phone-number JID
  from `LID.sqlite`'s `ZWAZACCOUNT`), then `ZWAZACCOUNT.ZDISPLAYNAME`.
  `ZWAGROUPMEMBER.ZCONTACTNAME` takes precedence when set, and 1:1 chats fall back to
  `ZWACHATSESSION.ZPARTNERNAME`.

## Snapshotting a live database safely

WhatsApp writes to `ChatStorage.sqlite` continuously (the `-wal` file grows while it syncs).

- **Don't** use `better-sqlite3`'s `backup()` with its default 100 pages per step. It releases the
  read transaction between steps, and SQLite restarts an online backup from page 0 whenever the
  source changes. Under steady writes it never finishes (reproduced: thousands of restarts, no
  progress).
- **Do** copy everything in one step (return more than `totalPages` from the progress callback),
  or use `VACUUM INTO` from a read-only connection. Both take one read transaction and finish in
  well under a second for a typical database.
- **Never** `cp` the `.sqlite` file on its own: the latest data is in the `-wal` file.
