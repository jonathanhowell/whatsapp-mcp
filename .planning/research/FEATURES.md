# Feature Research

**Domain:** MCP server for read-only WhatsApp Desktop (macOS native app) message access
**Researched:** 2026-04-07
**Confidence:** HIGH (database schema verified by direct inspection of live system)

---

## Database Reality (Verified)

The WhatsApp macOS native app (iOS Catalyst / `net.whatsapp.WhatsApp`) stores its data in:

```
~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/
  ChatStorage.sqlite          # Main messages + chats (22K+ messages, 693 chats)
  ContactsV2.sqlite           # Address book contacts (725 contacts)
  CallHistory.sqlite          # Call records
  fts/ChatSearchV5f.sqlite    # Full-text search index (4711 docs)
  ExtChatDB/ExtChatDatabase.sqlite  # Extended data (AI threads, broadcasts, etc.)
  Message/Media/{jid}/        # Media files organized by contact/group JID
```

This is distinct from `desktop.WhatsApp` (the Electron web wrapper) which uses IndexedDB
(LevelDB). The active WhatsApp 2.app uses the native Catalyst container above.

**Key tables confirmed:**

- `ZWACHATSESSION` — chats: ZCONTACTJID, ZPARTNERNAME, ZSESSIONTYPE (0=direct, 1=group, 2=broadcast, 3=status), ZUNREADCOUNT, ZLASTMESSAGEDATE, ZLASTMESSAGETEXT
- `ZWAMESSAGE` — messages: ZTEXT, ZMESSAGETYPE, ZMESSAGEDATE, ZISFROMME, ZFROMJID, ZTOJID, ZPUSHNAME, ZSTARRED, ZCHATSESSION (FK), ZMEDIAITEM (FK), ZPARENTMESSAGE (FK for threads)
- `ZWAMEDIAITEM` — attachments: ZMEDIALOCALPATH, ZMEDIAURL, ZFILESIZE, ZMOVIEDURATION, ZLATITUDE, ZLONGITUDE, ZVCARDSTRING, ZTITLE
- `ZWAADDRESSBOOKCONTACT` (ContactsV2) — contacts: ZFULLNAME, ZPHONENUMBER, ZWHATSAPPID, ZBUSINESSNAME, ZABOUTTEXT
- `ZWAPROFILEPUSHNAME` — display names: ZJID, ZPUSHNAME
- `ZWAGROUPMEMBER` — group membership: ZMEMBERJID, ZCONTACTNAME, ZISADMIN
- `ZWAGROUPINFO` — group metadata: ZCREATORJID, ZSUBJECTOWNERJID
- `fts/ChatSearchV5f.sqlite docs_content` — FTS index: c0text, c1contact, c2chat, c3documentType

**Message types (ZMESSAGETYPE values from live data):**
- 0: text (17,872 messages — most common)
- 1: image (2,645)
- 6: voice/audio (601)
- 7: sticker/GIF (711)
- 8: video (133)
- 10: document (162)
- 2: location (173)
- 14: system/group event (181)
- 59: poll (122)
- 66: reactions or reply (102)

**WAL mode active** (`.sqlite-shm` and `.sqlite-wal` files present). Direct reads work on the
live database but a snapshot copy (db + shm + wal) is safer for consistent reads without
interfering with the running app.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that make this MCP server usable for its core purpose. Missing any of these and
Claude cannot answer basic questions about WhatsApp conversations.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `list_chats` — list all conversations with name, type, last message preview | Entry point for any chat interaction; without it Claude cannot know what chats exist | LOW | Query ZWACHATSESSION; sort by ZLASTMESSAGEDATE; return ZPARTNERNAME, ZCONTACTJID, ZSESSIONTYPE, ZUNREADCOUNT, ZLASTMESSAGETEXT |
| `get_messages` — fetch messages from a specific chat with limit and date filters | Core read operation; Claude needs to read a conversation before it can extract tasks or answer questions | LOW | Query ZWAMESSAGE WHERE ZCHATSESSION = ? ORDER BY ZMESSAGEDATE; join ZWAPROFILEPUSHNAME for sender name |
| `search_messages` — full-text keyword search across all chats | Required for "did anyone mention X?" and task extraction across all conversations | MEDIUM | Option 1: LIKE query on ZWAMESSAGE.ZTEXT (slow at scale). Option 2: query fts/ChatSearchV5f.sqlite (fast, already indexed). Prefer FTS. |
| `get_messages_since` — fetch messages newer than a given timestamp | Polling for new messages is the primary use case stated in PROJECT.md | LOW | WHERE ZMESSAGEDATE > ? ORDER BY ZMESSAGEDATE ASC; ZMESSAGEDATE is Apple Cocoa epoch (seconds since 2001-01-01) |
| Configurable database path | Live DB and snapshot modes are both needed; hardcoding breaks the tool | LOW | Accept path via env var or config; default to `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` |
| Read-only connection enforcement | Safety guarantee; never risk corrupting WhatsApp data | LOW | Open SQLite with `PRAGMA query_only = ON;` or URI `?mode=ro` |
| `readOnlyHint: true` annotation on all tools | Allows Claude Desktop / Claude Code to auto-approve calls without user prompts; established pattern in iMessage MCP ecosystem | LOW | Set in tool definition metadata |

### Differentiators (Competitive Advantage)

Features that go beyond bare-minimum access and make the tool genuinely useful for a
personal assistant workflow.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `get_media_metadata` — return attachment type, filename, path, size alongside messages | Context without loading files; Claude can decide which media to actually retrieve | LOW | Join ZWAMEDIAITEM on ZWAMESSAGE.ZMEDIAITEM; return ZMEDIALOCALPATH, ZFILESIZE, ZMOVIEDURATION, ZTITLE |
| `get_media_file` — retrieve/serve a specific media file by path | Enables Claude to read documents, transcribe voice notes, or view images | MEDIUM | Resolve ZMEDIALOCALPATH relative to shared container; check file exists; return base64 or file URI; voice notes in opus/m4a format |
| Snapshot copy mode | Live DB has WAL journal and concurrent writes; snapshot is safer for consistent multi-query reads and won't block WhatsApp | LOW | Copy `.sqlite` + `.sqlite-shm` + `.sqlite-wal` atomically; open snapshot read-only |
| `get_chat` — detailed info for a single chat including group members | Disambiguates group context; lets Claude know who said what in group chats | LOW | Query ZWACHATSESSION + ZWAGROUPINFO + ZWAGROUPMEMBER for group chats; ZWAADDRESSBOOKCONTACT for direct chats |
| `get_contact` — look up a contact by name or phone number | Lets Claude resolve "messages from Alice" to a JID | LOW | Query ZWAADDRESSBOOKCONTACT in ContactsV2.sqlite; match on ZFULLNAME, ZPHONENUMBER, ZWHATSAPPID |
| Apple Cocoa epoch conversion | ZMESSAGEDATE stores seconds since 2001-01-01 UTC, not Unix epoch; returning raw values is unusable | LOW | Offset = 978307200 seconds; convert all timestamps to ISO 8601 before returning |
| Unread-only filter on `get_messages_since` | For task extraction, Claude only needs unread messages since last poll; reduces noise | LOW | Filter by ZUNREADCOUNT or ZMESSAGEDATE > last_seen_timestamp |
| Starred message retrieval | WhatsApp starred messages are already curated "important" items — high signal for task extraction | LOW | WHERE ZSTARRED = 1; trivial to implement |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but should be deliberately excluded.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Write/send messages | "Complete the loop" — have Claude respond in WhatsApp | Requires write access to the database or WhatsApp API; risks data corruption or account bans; fundamentally breaks the read-only safety guarantee | Keep the send channel separate (e.g., Shortcuts automation, a separate write-only tool that uses AppleScript/WhatsApp URI) |
| Real-time push / webhooks | "Get notified instantly" | Requires file system watching (FSEvents) or polling at the OS level; polling is simpler and sufficient for a personal assistant that checks periodically; adds runtime complexity | Use `get_messages_since` on a schedule from the Claude Code task runner |
| Full message decryption pipeline | "Access encrypted messages" | The native macOS app already stores messages decrypted in SQLite; adding a decryption layer would target backups, not the live DB; wrong scope | Read the already-decrypted local database directly |
| WhatsApp Web / Electron app support | "Works on more setups" | The Electron `desktop.WhatsApp` app uses IndexedDB (LevelDB), not SQLite — completely different access mechanism; mixing both adds major complexity | Scope explicitly to the iOS Catalyst native app (`net.whatsapp.WhatsApp`) only |
| Multi-account support | "I use two WhatsApp accounts" | Single container path; multiple accounts would require discovering multiple containers; out of scope for MVP | Document the single-account limitation; add as future work if validated |
| Message deletion / archiving | "Help me clean up chats" | Mutates the database; violates the read-only contract; risk of irreversible data loss | Out of scope by design |
| FTS index management (rebuilding the FTS index) | "Keep search index up to date" | WhatsApp manages ChatSearchV5f.sqlite itself; the MCP server should query it, not write to it | Read ZTEXT via LIKE if FTS index is stale; never write to WhatsApp's own FTS DB |
| Transcript generation / AI summarization inside the server | "Built-in summaries" | Business logic belongs in the Claude prompt layer, not the MCP tool layer; pollutes tool with model-specific concerns | Return raw message data; let Claude do summarization |

---

## Feature Dependencies

```
get_messages
    └──requires──> list_chats (need ZWACHATSESSION.Z_PK to query messages)
    └──requires──> Apple Cocoa epoch conversion (timestamps are unreadable without it)

get_messages_since
    └──requires──> get_messages (same query with date filter)
    └──enhances──> polling workflow (PROJECT.md core use case)

get_media_file
    └──requires──> get_media_metadata (need ZMEDIALOCALPATH before fetching file)
    └──requires──> get_messages (need to know a message has a ZMEDIAITEM)

search_messages
    └──enhances──> get_messages (search returns message IDs; fetch full context)
    └──optional──> FTS index (ChatSearchV5f.sqlite) OR fallback to LIKE query

get_chat
    └──requires──> list_chats (need chat JID)
    └──enhances──> get_messages (provides member context for group messages)

get_contact
    └──enhances──> get_chat, get_messages (resolves JID to human name)

snapshot_copy mode
    └──enhances──> all tools (safe concurrent read)
    └──conflicts──> live DB mode (can't use both simultaneously for same query)
```

### Dependency Notes

- **get_messages requires list_chats:** ZWAMESSAGE queries filter by ZCHATSESSION (integer FK). The caller needs to call `list_chats` first to get the chat's Z_PK or ZCONTACTJID.
- **All tools require epoch conversion:** Every timestamp in ChatStorage.sqlite is Apple Cocoa time (seconds since 2001-01-01). This conversion must be applied at the data layer, not left to callers.
- **get_media_file requires care with WAL:** If reading a snapshot, ZMEDIALOCALPATH points to the original media directory in the live container. Media files do not need to be copied — they can be read from `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media/{jid}/`.
- **FTS search enhances but doesn't replace LIKE:** ChatSearchV5f.sqlite appears to have 4,711 indexed docs vs 22,892 messages — not all messages are indexed. A LIKE fallback on ZWAMESSAGE.ZTEXT is needed for complete results.

---

## MVP Definition

### Launch With (v1)

Minimum viable to validate the core use case: Claude reading WhatsApp messages to extract actionable tasks.

- [x] `list_chats` — without this, nothing else works
- [x] `get_messages` — core read operation with limit + date filters
- [x] `get_messages_since` — polling for new messages (the primary trigger)
- [x] Apple Cocoa epoch conversion — timestamps are unreadable without this
- [x] Configurable database path (live or snapshot)
- [x] Read-only SQLite connection (`mode=ro` URI flag)
- [x] `readOnlyHint: true` on all tool definitions
- [x] Media metadata alongside messages (ZMEDIAITEM join in get_messages) — low effort, high value for context

### Add After Validation (v1.x)

Add once the core polling + task extraction workflow is working.

- [ ] `search_messages` — add when Claude needs cross-chat keyword search; use FTS index first, LIKE fallback
- [ ] `get_chat` with group member list — add when group chat context becomes important
- [ ] `get_contact` — add when Claude needs to resolve "messages from [name]" queries
- [ ] Snapshot copy mode — add if live DB reads cause WAL contention issues in practice

### Future Consideration (v2+)

Defer until core value is proven.

- [ ] `get_media_file` — useful for voice note transcription and document reading, but adds complexity (base64 encoding, file size limits, format handling); validate need first
- [ ] Starred messages tool — likely useful but not critical for MVP
- [ ] Call history access — low value for task extraction use case

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `list_chats` | HIGH | LOW | P1 |
| `get_messages` | HIGH | LOW | P1 |
| `get_messages_since` | HIGH | LOW | P1 |
| Epoch conversion | HIGH | LOW | P1 |
| Configurable DB path | HIGH | LOW | P1 |
| Read-only enforcement | HIGH | LOW | P1 |
| `readOnlyHint` annotations | MEDIUM | LOW | P1 |
| Media metadata in messages | MEDIUM | LOW | P1 |
| `search_messages` (FTS) | HIGH | MEDIUM | P2 |
| `get_chat` + group members | MEDIUM | LOW | P2 |
| `get_contact` lookup | MEDIUM | LOW | P2 |
| Snapshot copy mode | MEDIUM | LOW | P2 |
| `get_media_file` | MEDIUM | MEDIUM | P3 |
| Starred messages | LOW | LOW | P3 |
| Call history | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | lharries/whatsapp-mcp (Go + WhatsApp Web API) | felipeadeildo/whatsapp-mcp (Python + whatsmeow) | anipotts/imessage-mcp (iMessage, macOS) | Our Approach |
|---------|-----------------------------------------------|------------------------------------------------|-----------------------------------------|--------------|
| List chats | `list_chats` | `list_chats` | `list_group_chats` + contacts | `list_chats` — combines both |
| Read messages | `list_messages` with filters | `get_chat_messages` with pagination | `get_conversation` | `get_messages` with limit + date |
| Search | `list_messages` with context | `search_messages` + `find_chat` | `search_messages` | `search_messages` using FTS5 index |
| Contact lookup | `search_contacts`, `get_direct_chat_by_contact` | `find_chat` fuzzy | `resolve_contact` fuzzy | `get_contact` on ContactsV2.sqlite |
| Send messages | Yes (12 send tools) | Yes (`send_message`) | Yes (some implementations) | No — read-only by design |
| Media | `download_media` | `send_file` | `list_attachments` | `get_media_metadata` (v1), `get_media_file` (v1.x) |
| Real-time | Yes (WhatsApp Web API connection) | Yes (whatsmeow sync) | No | No — polling via `get_messages_since` |
| Database | Custom SQLite populated via WhatsApp Web | Custom SQLite via whatsmeow | macOS Messages.app SQLite (chat.db) | Native WhatsApp SQLite (ChatStorage.sqlite) |
| Auth required | Yes (QR code scan) | Yes (QR code scan) | No (local file read) | No (local file read) |
| Privacy | Messages go through WhatsApp Web API | Messages go through WhatsApp Web API | Local only | Local only |
| Annotations | Not documented | Not documented | `readOnlyHint: true` on all 26 tools | `readOnlyHint: true` on all tools |

**Key differentiation:** The lharries and felipeadeildo MCP servers work by re-establishing a WhatsApp Web connection (requiring QR code authentication, always-on process, and routing all messages through an unofficial API). This project reads the already-decrypted local SQLite database directly — no authentication, no network traffic, no unofficial API usage, fully local and private.

---

## Sources

- Direct inspection of live WhatsApp database on the development machine (HIGH confidence — first-hand schema)
- [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) — Go + WhatsApp Web API MCP server
- [felipeadeildo/whatsapp-mcp](https://github.com/felipeadeildo/whatsapp-mcp) — Python MCP server with 7 tools
- [anipotts/imessage-mcp](https://github.com/anipotts/imessage-mcp) — 26-tool read-only iMessage MCP server (design pattern reference)
- [carterlasalle/mac_messages_mcp](https://github.com/carterlasalle/mac_messages_mcp) — iMessage MCP with readOnlyHint pattern
- [kacos2000/Queries WhatsApp_Chatstorage_sqlite.sql](https://github.com/kacos2000/queries/blob/master/WhatsApp_Chatstorage_sqlite.sql) — SQL reference for ChatStorage schema
- lsof inspection of running WhatsApp process (PID 68368) confirming database file paths

---
*Feature research for: WhatsApp MCP Server (read-only macOS native app)*
*Researched: 2026-04-07*
