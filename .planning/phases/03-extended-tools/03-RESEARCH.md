# Phase 03: Extended Tools - Research

**Researched:** 2026-04-08
**Domain:** WhatsApp SQLite schema (ChatStorage.sqlite, ContactsV2.sqlite), media file retrieval, MCP tool registration
**Confidence:** HIGH

## Summary

This phase adds four MCP tools that complete the v1 surface: `search_messages`, `get_contact`, `get_chat`, and `get_media_file`. All four build directly on the established Phase 2 patterns — same `registerXTool` function signature, same `prepare().all()` query pattern, same `{ content: [{ type: "text", text: JSON.stringify(...) }] }` response shape.

The primary new integration points are: (1) ContactsV2.sqlite, a second SQLite database that requires a separate read-only connection derived from `config.dbPath`, and (2) media file contents on disk, accessed via `ZMEDIALOCALPATH` values stored in `ZWAMEDIAITEM` which are relative to `path.join(path.dirname(config.dbPath), 'Message')`.

Key findings from live schema inspection: `ZWAGROUPMEMBER` exists in ChatStorage.sqlite with `ZMEMBERJID`, `ZCONTACTNAME`, `ZISADMIN`, `ZISACTIVE` columns; `ZWAGROUPINFO` links to `ZWACHATSESSION` via `ZCHATSESSION`; `ZWAADDRESSBOOKCONTACT` in ContactsV2.sqlite has `ZFULLNAME`, `ZPHONENUMBER`, `ZWHATSAPPID`, `ZLOCALIZEDPHONENUMBER`, `ZBUSINESSNAME`; and `LIKE` search on 22,949 messages completes in ~127ms — well under any perceptible threshold.

**Primary recommendation:** Follow existing tool file patterns exactly. New path for ContactsV2 is `path.join(path.dirname(config.dbPath), 'ContactsV2.sqlite')`. Media base path is `path.join(path.dirname(config.dbPath), 'Message')`. Use `path.extname()` for MIME type detection with a small hand-crafted map (only `.jpg`, `.opus`, `.pdf`, `.mp4` observed in practice).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `search_messages` uses LIKE-only (no FTS5). FTS5 covers ~21% of messages; LIKE fallback would be required anyway. At ~23K messages, LIKE performance is negligible. Eliminates dual-path complexity.

**D-02:** Search results grouped by chat (same structure as `get_messages_since`) — each chat shows its matching messages.

**D-03:** Full message text returned for each match (not snippets). Consistent with `get_messages` behavior.

**D-04:** Same 1000 result cap with `has_more` + cursor pagination (carried forward from Phase 2 D-07/D-08).

**D-05:** `get_media_file` returns base64-encoded content inline for files under 5 MB. Files over 5 MB return file path only.

**D-06:** When media file doesn't exist on disk, return available metadata from DB (type, filename, size) plus a clear message like "File not found on disk — may have been deleted or not downloaded". This is a normal response (not `isError`).

**D-07:** `get_contact` opens a second read-only database connection to ContactsV2.sqlite for full contact details. Satisfies TOOL-05 requirement for contact lookup by name or phone.

**D-08:** `get_chat` returns group member list with JID and resolved display name for each member.

### Claude's Discretion

- SQL query structure and JOIN strategy for search, contact, and chat queries
- How to discover and open ContactsV2.sqlite (path resolution, schema validation)
- MIME type detection for media files
- Case sensitivity behavior for search (case-insensitive LIKE is SQLite default with `NOCASE`)
- Module/file organization for new tool files (follow existing `src/tools/` pattern)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOOL-04 | `search_messages` — full-text search across all chats using FTS5 index with LIKE fallback | D-01 locks LIKE-only. Schema verified: `ZWAMESSAGE.ZTEXT` column is the target. LIKE on 22,949 rows completes in ~127ms. Same grouped-by-chat response structure as `get_messages_since`. |
| TOOL-05 | `get_contact` — look up contact details (name, phone number) by name or phone | `ZWAADDRESSBOOKCONTACT` schema verified. Key columns: `ZFULLNAME`, `ZPHONENUMBER`, `ZWHATSAPPID`, `ZLOCALIZEDPHONENUMBER`, `ZBUSINESSNAME`. Indexes on `ZPHONENUMBER` and `ZWHATSAPPID`. Path: `path.join(path.dirname(config.dbPath), 'ContactsV2.sqlite')`. |
| TOOL-06 | `get_chat` — returns detailed chat info including group members for group chats | `ZWACHATSESSION`, `ZWAGROUPINFO`, `ZWAGROUPMEMBER`, `ZWAPROFILEPUSHNAME` all verified. JOIN path: `ZWACHATSESSION -> ZWAGROUPINFO (via ZCHATSESSION) -> ZWAGROUPMEMBER (via ZCHATSESSION)`. Name resolution: `ZCONTACTNAME ?? ppn.ZPUSHNAME ?? null`. |
| TOOL-07 | `get_media_file` — retrieves a media file by message ID | Media path verified: `ZMEDIALOCALPATH` on `ZWAMEDIAITEM` is relative to `path.join(path.dirname(config.dbPath), 'Message')`. Extensions in practice: `.jpg`, `.opus`, `.pdf`, `.mp4`. 5 MB gate governs inline vs path-only response. |
</phase_requirements>

---

## Standard Stack

### Core (no additions needed)

All Phase 3 tools use the existing project stack. No new runtime dependencies are required.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | 12.8.0 | SQLite queries — ChatStorage + ContactsV2 | Already in project. Second connection for ContactsV2 opened with same `{ readonly: true, fileMustExist: true }` options. |
| `node:fs` | built-in | Read media files from disk, check file existence | Built-in. `fs.existsSync()` for presence check, `fs.readFileSync()` for content. |
| `node:path` | built-in | Resolve ContactsV2.sqlite path and media base path | Built-in. `path.dirname(config.dbPath)` is the shared container root. |
| `node:buffer` | built-in | Base64 encode media file contents | Built-in. `Buffer.from(fileBytes).toString('base64')`. |

### MIME Type Detection

`mime-types@3.0.2` is already installed as a transitive dependency (pulled in by `@modelcontextprotocol/sdk`). However, since it is not a declared direct dependency, relying on it would be fragile. The set of extensions observed in this database is exactly four: `.jpg`, `.opus`, `.pdf`, `.mp4`. A small inline map is safer and has no dependency risk.

```typescript
const MIME_TYPES: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.opus': 'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.pdf':  'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
```

**Confidence:** HIGH — verified against live `ZWAMEDIAITEM` data.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/better-sqlite3` | 7.6.13+ | TypeScript types for second DB connection | Already installed as devDep |

### Alternatives Considered

| Recommended | Alternative | Tradeoff |
|-------------|-------------|----------|
| Inline MIME map | `mime-types` npm package | mime-types is a transitive dep — undeclared. An inline map for 4-6 extensions is more explicit with no dependency risk. |
| Inline MIME map | `node:path` extension only, no MIME | If content-type is never exposed in the response, MIME type is only used for internal documentation. The planner should decide whether to include `content_type` in the response or not. |

---

## Architecture Patterns

### Recommended Project Structure

No new directories are needed. Follow the existing `src/tools/` pattern:

```
src/
├── tools/
│   ├── list-chats.ts           # Phase 2 — existing
│   ├── get-messages.ts         # Phase 2 — existing
│   ├── get-messages-since.ts   # Phase 2 — existing
│   ├── refresh-snapshot.ts     # Phase 1 — existing
│   ├── search-messages.ts      # Phase 3 — NEW
│   ├── get-contact.ts          # Phase 3 — NEW
│   ├── get-chat.ts             # Phase 3 — NEW
│   └── get-media-file.ts       # Phase 3 — NEW
├── db/
│   ├── connection.ts           # DatabaseHandle interface
│   ├── snapshot.ts
│   └── validate.ts
├── config/
│   └── loader.ts               # Config interface has dbPath
├── utils/
│   └── time.ts
├── server.ts
└── index.ts                    # Wiring: 4 new registerXTool() calls
```

### Pattern 1: Tool Registration (established — Phase 2)

```typescript
// Source: src/tools/get-messages-since.ts
export function registerSearchMessagesTool(
  server: McpServer,
  getState: () => { config: Config; handle: DatabaseHandle }
): void {
  server.registerTool(
    "search_messages",
    {
      description: "...",
      inputSchema: { query: z.string().describe("..."), /* ... */ },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { handle } = getState();
        // ... query logic ...
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Failed to search messages: ${message}` }], isError: true };
      }
    }
  );
}
```

### Pattern 2: search_messages — LIKE Query with Grouped Response

Mirrors `get_messages_since` grouped-by-chat structure. Pagination cursor uses `message_date` (Apple epoch converted to ISO).

```typescript
const SEARCH_MESSAGES_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZCHATSESSION    AS chat_session_id,
    cs.ZPARTNERNAME   AS chat_name,
    cs.ZCONTACTJID    AS chat_jid,
    ppn.ZPUSHNAME     AS chat_push_name,
    m.ZTEXT           AS text,
    m.ZMESSAGEDATE    AS message_date,
    m.ZMESSAGETYPE    AS message_type,
    m.ZISFROMME       AS is_from_me,
    m.ZPUSHNAME       AS sender_name,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title
  FROM ZWAMESSAGE m
  JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.ZTEXT LIKE ? ESCAPE '\\'
  ORDER BY m.ZMESSAGEDATE DESC
  LIMIT ?
`;
// Bind: `%${query}%`, CAP + 1
```

**Case sensitivity:** SQLite `LIKE` is case-insensitive by default for ASCII characters. Unicode case folding requires `PRAGMA case_sensitive_like = OFF` (the default) — no extra work needed.

**Cursor pagination:** When `has_more` is true, `next_cursor` is the ISO timestamp of the last returned message. Subsequent calls should filter `WHERE m.ZMESSAGEDATE < cursor_apple_epoch`.

### Pattern 3: get_contact — Second Database Connection

ContactsV2.sqlite is in WAL mode (`.sqlite-shm` and `.sqlite-wal` present). Open with the same `{ readonly: true, fileMustExist: true }` options used for the snapshot. Do NOT open with `timeout: 0` — there is no lock contention risk from a read-only connection against a database WhatsApp writes infrequently.

```typescript
// Path derivation — verified against live filesystem
import path from "node:path";

const contactsDbPath = path.join(path.dirname(config.dbPath), 'ContactsV2.sqlite');
const contactsDb = new Database(contactsDbPath, { readonly: true, fileMustExist: true });
```

**Search SQL — ContactsV2:**

```sql
SELECT
  Z_PK             AS contact_id,
  ZFULLNAME        AS full_name,
  ZGIVENNAME       AS given_name,
  ZLASTNAME        AS last_name,
  ZPHONENUMBER     AS phone_number,
  ZLOCALIZEDPHONENUMBER AS localized_phone,
  ZWHATSAPPID      AS whatsapp_jid,
  ZBUSINESSNAME    AS business_name
FROM ZWAADDRESSBOOKCONTACT
WHERE ZFULLNAME LIKE ? ESCAPE '\\'
   OR ZPHONENUMBER LIKE ? ESCAPE '\\'
ORDER BY ZFULLNAME ASC
LIMIT 20
```

Indexes on `ZPHONENUMBER` and `ZWHATSAPPID` exist. `ZFULLNAME` has no index — full scan for name search, acceptable at contact-list scale (thousands of rows).

**Connection lifecycle:** Open on each `get_contact` call, close in `finally` block. ContactsV2 is a small database; connection overhead is negligible.

### Pattern 4: get_chat — Chat Detail with Group Members

Two queries: (1) chat + group info, (2) group members. Avoids a complex multi-row JOIN that would repeat chat metadata for every member.

```sql
-- Query 1: Chat + group info
SELECT
  cs.Z_PK             AS chat_id,
  cs.ZCONTACTJID      AS jid,
  cs.ZPARTNERNAME     AS partner_name,
  ppn.ZPUSHNAME       AS push_name,
  cs.ZSESSIONTYPE     AS session_type,
  cs.ZUNREADCOUNT     AS unread_count,
  cs.ZLASTMESSAGEDATE AS last_message_date,
  cs.ZLASTMESSAGETEXT AS last_message_text,
  gi.ZOWNERJID        AS owner_jid,
  gi.ZCREATORJID      AS creator_jid,
  gi.ZCREATIONDATE    AS created_at
FROM ZWACHATSESSION cs
LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
LEFT JOIN ZWAGROUPINFO gi ON gi.ZCHATSESSION = cs.Z_PK
WHERE cs.Z_PK = ?

-- Query 2: Active group members (only when session_type = 1)
SELECT
  gm.ZMEMBERJID    AS jid,
  gm.ZISADMIN      AS is_admin,
  COALESCE(gm.ZCONTACTNAME, ppn.ZPUSHNAME) AS display_name
FROM ZWAGROUPMEMBER gm
LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = gm.ZMEMBERJID
WHERE gm.ZCHATSESSION = ?
  AND gm.ZISACTIVE = 1
ORDER BY gm.ZISADMIN DESC, gm.ZMEMBERJID ASC
```

**Name resolution reality:** 75% of group members in this database use `@lid` JIDs (WhatsApp's new internal identifier format). `ZCONTACTNAME` is empty for all members (`COUNT = 0` observed). `ZWAPROFILEPUSHNAME` resolves ~16% of members. The remaining ~84% will have `display_name: null`. This is expected behavior, not a bug — the tool should document it in its description.

### Pattern 5: get_media_file — File Retrieval with Base64 Gate

```typescript
// Path construction — verified against live filesystem
const mediaBase = path.join(path.dirname(config.dbPath), 'Message');
const fullPath = path.join(mediaBase, mediaLocalPath);

const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB (D-05)

if (!fs.existsSync(fullPath)) {
  // D-06: normal response (not isError), include metadata
  return {
    content: [{ type: "text", text: JSON.stringify({
      message_id: args.message_id,
      found: false,
      note: "File not found on disk — may have been deleted or not downloaded",
      metadata: { filename: row.media_title, file_size: row.media_file_size, type: messageType }
    }, null, 2) }]
  };
}

const stat = fs.statSync(fullPath);
if (stat.size > SIZE_LIMIT) {
  return {
    content: [{ type: "text", text: JSON.stringify({
      message_id: args.message_id,
      found: true,
      inline: false,
      file_path: fullPath,
      file_size: stat.size,
      note: "File exceeds 5 MB — use file_path to access directly"
    }, null, 2) }]
  };
}

const bytes = fs.readFileSync(fullPath);
const base64 = bytes.toString('base64');
const ext = path.extname(fullPath).toLowerCase();
const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
```

**SQL to fetch media info by message_id:**

```sql
SELECT
  m.Z_PK            AS message_id,
  m.ZMESSAGETYPE    AS message_type,
  mi.ZMEDIALOCALPATH AS media_path,
  mi.ZFILESIZE      AS media_file_size,
  mi.ZTITLE         AS media_title
FROM ZWAMESSAGE m
JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
WHERE m.Z_PK = ?
```

**Edge case — no media item:** If `m.ZMEDIAITEM IS NULL` (the message has no media), the JOIN returns no rows. Return `isError: true` with a clear message like "Message ID X has no media attachment".

### Pattern 6: Tool Wiring in index.ts

```typescript
// In main(), after existing registerXTool calls:
registerSearchMessagesTool(server, getState);
registerGetContactTool(server, getState);
registerGetChatTool(server, getState);
registerGetMediaFileTool(server, getState);
```

### Anti-Patterns to Avoid

- **Opening ContactsV2 once at startup and storing in DatabaseHandle:** ContactsV2 is not snapshotted. Storing the connection in `DatabaseHandle` couples it to the snapshot lifecycle. Open per-call and close in `finally`.
- **Using `fs.copyFileSync` for ContactsV2 during snapshot:** ContactsV2 is in WAL mode. If a snapshot of ContactsV2 were ever needed, use `.backup()` — but for `get_contact`, a direct read-only connection is sufficient.
- **Deriving media base path from `handle.snapshotPath`:** The snapshot is a copy of ChatStorage.sqlite only. Media files remain at their original location under `config.dbPath`'s parent directory. Always use `config.dbPath`, not `handle.snapshotPath`, for path derivation.
- **Returning `isError: true` for missing media files:** D-06 specifies this is a normal response. Claude needs to know what the file was even if it's not available.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Apple epoch conversion | Custom timestamp math | `appleEpochToISO()` in `src/utils/time.ts` | Already implemented and tested |
| Message type labels | Custom type mapping | `resolveMessageType()` in `src/utils/time.ts` | Already implemented with full map |
| Grouped-by-chat response assembly | Custom chat grouping | Copy the `chatMap` pattern from `get-messages-since.ts` | Established pattern — same output shape required by D-02 |
| Pagination logic | Custom cursor handling | Copy the `CAP + 1` / `hasMore` / `nextCursor` pattern from Phase 2 | Identical semantics required by D-04 |
| SQLite LIKE search | FTS5 virtual tables or custom indexes | Plain `ZTEXT LIKE ?` | D-01 locks this decision |

---

## Verified Schema Facts (HIGH confidence — from live database)

### ChatStorage.sqlite

**ZWAMESSAGE:** `Z_PK`, `ZTEXT`, `ZMESSAGEDATE`, `ZMESSAGETYPE`, `ZISFROMME`, `ZCHATSESSION`, `ZMEDIAITEM`, `ZPUSHNAME`, `ZFROMJID`, `ZSTARRED`, `ZGROUPMEMBER`

**ZWAMEDIAITEM:** `Z_PK`, `ZMEDIALOCALPATH`, `ZFILESIZE`, `ZTITLE`, `ZMESSAGE`
- `ZMEDIALOCALPATH` format: `Media/<jid>/<hex>/<hex>/<uuid>.<ext>` — relative to `Message/` directory
- Extensions observed in this database: `.jpg`, `.opus`, `.pdf`, `.mp4`
- `ZFILESIZE` is in bytes

**ZWACHATSESSION:** `Z_PK`, `ZCONTACTJID`, `ZPARTNERNAME`, `ZSESSIONTYPE`, `ZUNREADCOUNT`, `ZLASTMESSAGEDATE`, `ZLASTMESSAGETEXT`, `ZGROUPINFO` (FK to ZWAGROUPINFO)
- `ZSESSIONTYPE`: 0 = individual, 1 = group, 2 = broadcast, 3 = status

**ZWAGROUPINFO:** `Z_PK`, `ZCHATSESSION` (FK back to ZWACHATSESSION), `ZOWNERJID`, `ZCREATORJID`, `ZCREATIONDATE`, `ZSUBJECTTIMESTAMP`

**ZWAGROUPMEMBER:** `Z_PK`, `ZCHATSESSION`, `ZMEMBERJID`, `ZCONTACTNAME`, `ZISADMIN`, `ZISACTIVE`
- `ZCONTACTNAME` is empty for all rows in this database (WhatsApp no longer populates it)
- `ZMEMBERJID` mix: `@lid` (75%) and `@s.whatsapp.net` (25%)
- `ZISACTIVE = 1` for current members
- Index: `ZWAGROUPMEMBER_ZCHATSESSION_INDEX`

**ZWAPROFILEPUSHNAME:** `Z_PK`, `ZJID`, `ZPUSHNAME`
- Contains both `@s.whatsapp.net` and `@lid` JIDs
- Resolves ~16% of group member @lid JIDs to display names

### ContactsV2.sqlite

**ZWAADDRESSBOOKCONTACT:** Key columns for `get_contact`:
- `ZFULLNAME` — display name (e.g., "Ben Dalby")
- `ZPHONENUMBER` — international format with + prefix (e.g., "+447788427868")
- `ZLOCALIZEDPHONENUMBER` — locale-formatted variant
- `ZWHATSAPPID` — JID format (e.g., "447788427868@s.whatsapp.net")
- `ZBUSINESSNAME` — set for business accounts
- Indexes: `byPhoneNumberIndex`, `byWhatsAppIDIndex`

**Path:** `path.join(path.dirname(config.dbPath), 'ContactsV2.sqlite')`

### Media File System

**Media base path:** `path.join(path.dirname(config.dbPath), 'Message')`
- Verified: `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media/<jid>/...`
- Full path = `mediaBase + '/' + ZMEDIALOCALPATH`
- Files may not exist (deleted, expired, or never downloaded to this device)

---

## Common Pitfalls

### Pitfall 1: Deriving Media Path from Snapshot Path Instead of Config

**What goes wrong:** If the planner passes `handle.snapshotPath` to the media file tool, the media base path will resolve to a temp directory (`/tmp/whatsapp-mcp/Message/...`) that does not exist.

**Why it happens:** The snapshot is a copy of the database file only. Media files stay at their original location.

**How to avoid:** Always compute `mediaBase = path.join(path.dirname(config.dbPath), 'Message')`. The tool receives `getState()` which returns both `config` and `handle` — use `config.dbPath`, not `handle.snapshotPath`.

**Warning signs:** `ENOENT` errors for all media files even when the database query succeeds.

### Pitfall 2: ContactsV2 Connection Not Closed

**What goes wrong:** Better-sqlite3 connections hold a file handle. Failing to close ContactsV2 connection will accumulate open file descriptors if `get_contact` is called repeatedly.

**Why it happens:** The happy path works; the error path skips `finally`.

**How to avoid:** Always wrap the ContactsV2 connection in `try/finally` and call `contactsDb.close()` in the `finally` block.

### Pitfall 3: @lid JID Name Resolution Returns Null for Most Group Members

**What goes wrong:** `get_chat` returns `display_name: null` for most group members, appearing broken.

**Why it happens:** WhatsApp migrated to `@lid` (Linked ID) format for privacy. `ZCONTACTNAME` on `ZWAGROUPMEMBER` is no longer populated. `ZWAPROFILEPUSHNAME` only has entries for contacts you've messaged directly.

**How to avoid:** This is expected behavior. The tool description and response should clearly note that names may not be resolvable for all members. Return `jid` always; `display_name: null` is valid.

**Warning signs:** Testing shows 0 names for all members — this is correct for a fresh inspection.

### Pitfall 4: search_messages LIKE Escaping

**What goes wrong:** If the user's query contains `%` or `_`, SQLite interprets them as LIKE wildcards, returning unexpected results.

**Why it happens:** SQLite LIKE uses `%` (any sequence) and `_` (any character) as wildcards.

**How to avoid:** Escape the user's query before wrapping in `%...%`:
```typescript
const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
// Then bind: `%${escaped}%` with ESCAPE '\\'
```

### Pitfall 5: Pagination Cursor Direction for search_messages

**What goes wrong:** If `next_cursor` uses `ZMESSAGEDATE DESC` ordering but subsequent calls use `m.ZMESSAGEDATE > cursor`, the next page returns older messages instead of newer.

**Why it happens:** Mismatch between sort order and cursor comparison direction.

**How to avoid:** With `ORDER BY m.ZMESSAGEDATE DESC`, the cursor from the last returned row is the oldest timestamp in the page. The next page must use `WHERE m.ZMESSAGEDATE < cursor_apple_epoch` to continue descending.

### Pitfall 6: ContactsV2 fileMustExist Fails if Contacts Not Synced

**What goes wrong:** `new Database(contactsPath, { fileMustExist: true })` throws if ContactsV2.sqlite doesn't exist (rare but possible on fresh WhatsApp install).

**Why it happens:** ContactsV2.sqlite is created when WhatsApp syncs the address book.

**How to avoid:** Check `fs.existsSync(contactsPath)` before opening. If absent, return a clear error: "ContactsV2.sqlite not found — open WhatsApp Desktop and allow contact sync".

---

## Code Examples

### search_messages Result Structure

```typescript
// Mirrors get_messages_since response structure
{
  chats: [
    {
      chat_id: 42,
      chat_name: "Family Group",
      messages: [
        {
          message_id: 1234,
          timestamp: "2026-04-01T14:22:00.000Z",
          type: "text",
          is_from_me: false,
          sender_name: "Mum",
          text: "...sailing weekend..."
        }
      ]
    }
  ],
  total_messages: 14,
  has_more: false,
  next_cursor: null
}
```

### get_contact Result Structure

```typescript
{
  contacts: [
    {
      contact_id: 123,
      full_name: "Ben Dalby",
      phone_number: "+447788427868",
      localized_phone: "+44 7788 427868",
      whatsapp_jid: "447788427868@s.whatsapp.net",
      business_name: null
    }
  ],
  total: 1
}
```

### get_chat Result Structure

```typescript
{
  chat_id: 2,
  jid: "447776306601-1578599009@g.us",
  name: "Tamesis Club",
  type: "group",
  unread_count: 0,
  last_message_at: "2026-04-08T09:00:00.000Z",
  last_message_preview: "See everyone Sunday",
  group_info: {
    owner_jid: "635755868290@lid",
    creator_jid: "635755868290@lid",
    created_at: "2020-01-09T00:00:00.000Z",
    member_count: 128,
    members: [
      { jid: "95541597843661@lid", is_admin: true, display_name: null },
      { jid: "447962345678@s.whatsapp.net", is_admin: false, display_name: "Jo" }
    ]
  }
}
```

### get_media_file Result Structures

```typescript
// File found, under 5 MB:
{
  message_id: 611,
  found: true,
  inline: true,
  filename: "agenda.pdf",
  file_size: 82702,
  content_type: "application/pdf",
  data: "<base64 string>"
}

// File found, over 5 MB:
{
  message_id: 999,
  found: true,
  inline: false,
  filename: "video.mp4",
  file_size: 8388608,
  file_path: "/Users/x/Library/Group Containers/.../Message/Media/.../video.mp4",
  note: "File exceeds 5 MB — use file_path to access directly"
}

// File not on disk:
{
  message_id: 500,
  found: false,
  note: "File not found on disk — may have been deleted or not downloaded",
  metadata: { filename: "photo.jpg", file_size: 240301, type: "image" }
}

// No media attachment on message:
// isError: true response — "Message ID X has no media attachment"
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `better-sqlite3` | All queries | Yes | 12.8.0 | — |
| `node:fs`, `node:path`, `node:buffer` | get_media_file | Yes | built-in | — |
| ContactsV2.sqlite | get_contact | Yes | — (WhatsApp-managed) | Return "ContactsV2 not found" error |
| WhatsApp Message/Media directory | get_media_file | Yes (verified) | — | Return "file not found" response (D-06) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** ContactsV2.sqlite — handled with `fs.existsSync()` check before opening.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Group member JIDs as `@s.whatsapp.net` | Migrated to `@lid` (Linked ID) | ~2023-2024 WhatsApp Desktop update | `ZCONTACTNAME` unpopulated; name resolution limited to ZWAPROFILEPUSHNAME |
| FTS5 full-text index for search | LIKE-only (D-01 locked) | Phase 3 design decision | Simpler code, identical coverage given FTS5 covers only 21% of messages |

**Notes:**
- WhatsApp's `@lid` JID migration is ongoing. New messages use `@lid`; older message records may retain `@s.whatsapp.net`. Queries using `ZWAPROFILEPUSHNAME` JOIN work across both formats since that table contains both JID types.

---

## Open Questions

1. **search_messages cursor: should it be time-based or ID-based?**
   - What we know: Phase 2 `get_messages` uses a time-based cursor (ISO timestamp). `get_messages_since` effectively uses a time-based cursor too.
   - What's unclear: For search results sorted by `ZMESSAGEDATE DESC`, a time-based cursor is slightly imprecise if multiple messages have the same timestamp (rare but possible).
   - Recommendation: Use the same time-based cursor pattern for consistency with Phase 2. The risk of identical timestamps in the same search result page is negligible.

2. **ContactsV2 snapshot vs live read**
   - What we know: D-07 says "opens a second read-only database connection to ContactsV2.sqlite". ContactsV2 is in WAL mode.
   - What's unclear: Should the tool snapshot ContactsV2 (like ChatStorage) or read it live?
   - Recommendation: Read it live. Contact data changes rarely and live reads are safe with `readonly: true`. Creating a second snapshot adds complexity and the snapshot lifecycle is already scoped to ChatStorage.sqlite only. A live read-only connection against a WAL database is always safe.

3. **get_chat: should it return members for individual chats?**
   - What we know: D-08 says "group member list" — implies groups only. `ZSESSIONTYPE = 1` for groups.
   - Recommendation: Return `group_info: null` for non-group chats. The `group_info` field is conditionally populated only when `session_type == "group"`.

---

## Sources

### Primary (HIGH confidence)
- Live database inspection via `sqlite3` CLI against `ChatStorage.sqlite` and `ContactsV2.sqlite` — all schema facts, path verification, query testing, and performance measurement are direct observations
- `src/db/connection.ts`, `src/config/loader.ts`, `src/tools/get-messages-since.ts`, `src/tools/get-messages.ts`, `src/tools/list-chats.ts` — established patterns extracted directly from source

### Secondary (MEDIUM confidence)
- `CLAUDE.md` project constraints — WhatsApp database table names, tech stack, library versions
- `.planning/phases/03-extended-tools/03-CONTEXT.md` — locked decisions (D-01 through D-08)

---

## Metadata

**Confidence breakdown:**
- Schema facts (ZWAGROUPMEMBER, ContactsV2, ZWAMEDIAITEM): HIGH — verified against live database
- Path resolution (ContactsV2, media): HIGH — verified with `ls` against live filesystem
- LIKE search performance: HIGH — timed directly (127ms for 22,949 rows)
- Name resolution completeness (16% for @lid members): HIGH — counted directly
- Architecture patterns: HIGH — copied from existing Phase 2 source files
- MIME type map: HIGH — verified against actual extensions in database

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (WhatsApp schema is stable; @lid migration is ongoing but additive)
