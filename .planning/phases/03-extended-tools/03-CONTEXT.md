# Phase 3: Extended Tools - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Four new MCP tools (`search_messages`, `get_contact`, `get_chat`, `get_media_file`) that complete the v1 tool surface. Search provides keyword lookup across all chats, contact and chat detail tools provide richer metadata, and media retrieval serves file contents to Claude.

</domain>

<decisions>
## Implementation Decisions

### Search Strategy
- **D-01:** `search_messages` uses LIKE-only (no FTS5). FTS5 index covers only ~21% of messages, so LIKE fallback would be required anyway. At ~23K messages, LIKE performance is negligible. Eliminates dual-path complexity.
- **D-02:** Search results grouped by chat (same structure as `get_messages_since`) — each chat shows its matching messages. Easier for Claude to summarize by conversation.
- **D-03:** Full message text returned for each match (not snippets). Consistent with `get_messages` behavior.
- **D-04:** Same 1000 result cap with `has_more` + cursor pagination (carried forward from Phase 2 D-07/D-08).

### Media Retrieval
- **D-05:** `get_media_file` returns base64-encoded content inline for files under 5 MB. Files over 5 MB return file path only. Covers most photos, voice notes, and short videos.
- **D-06:** When media file doesn't exist on disk (deleted, expired, not downloaded), return available metadata from DB (type, filename, size) plus a clear message like "File not found on disk — may have been deleted or not downloaded". This is a normal response (not `isError`), so Claude still gets context about what the file was.

### Contact & Chat Detail
- **D-07:** `get_contact` opens a second read-only database connection to ContactsV2.sqlite for full contact details (phone number, name). Satisfies TOOL-05 requirement for contact lookup by name or phone.
- **D-08:** `get_chat` returns group member list with JID and resolved display name for each member. Enough for Claude to identify participants without full profile cross-referencing.

### Claude's Discretion
- SQL query structure and JOIN strategy for search, contact, and chat queries
- How to discover and open ContactsV2.sqlite (path resolution, schema validation)
- MIME type detection for media files
- Case sensitivity behavior for search (case-insensitive LIKE is SQLite default with `NOCASE`)
- Module/file organization for new tool files (follow existing `src/tools/` pattern)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `CLAUDE.md` — Tech stack decisions, library versions, WhatsApp database location and table names (ZWAMESSAGE, ZWAMEDIAITEM, ZWACHATSESSION, ZWAPROFILEPUSHNAME), version compatibility
- `.planning/REQUIREMENTS.md` — TOOL-04, TOOL-05, TOOL-06, TOOL-07 define this phase's requirements
- `.planning/ROADMAP.md` — Phase 3 success criteria and scope boundary

### Phase 1 & 2 Foundation
- `src/tools/list-chats.ts` — Tool registration pattern, SQL query pattern, name resolution
- `src/tools/get-messages.ts` — Message query pattern, media metadata JOIN, pagination with cursor
- `src/tools/get-messages-since.ts` — Grouped-by-chat response structure (model for search results)
- `src/db/connection.ts` — DatabaseHandle interface, openDatabase/refreshSnapshot patterns
- `src/utils/time.ts` — `appleEpochToISO()`, `isoToAppleEpoch()`, `resolveMessageType()`, `MESSAGE_TYPE_MAP`
- `src/index.ts` — Tool wiring in main() function

### Prior Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions (snapshot lifecycle, error messaging, config design)
- `.planning/phases/02-core-tools/02-CONTEXT.md` — Phase 2 decisions (response format, pagination, message types, polling design)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `appleEpochToISO()` / `isoToAppleEpoch()` in `src/utils/time.ts` — timestamp conversion
- `resolveMessageType()` / `MESSAGE_TYPE_MAP` in `src/utils/time.ts` — message type resolution
- `registerGetMessagesSinceTool()` in `src/tools/get-messages-since.ts` — grouped-by-chat response template (reuse for search results)
- `registerGetMessagesTool()` in `src/tools/get-messages.ts` — media metadata JOIN pattern, pagination logic
- `DatabaseHandle` interface in `src/db/connection.ts` — provides `db` instance for queries

### Established Patterns
- Tool registration: `registerXTool(server, getState)` function per tool file in `src/tools/`
- MCP responses: `{ content: [{ type: "text", text: JSON.stringify(...) }] }` with optional `isError: true`
- SQL: `prepare().all()` with typed row interfaces
- Media metadata: JOIN `ZWAMEDIAITEM` via `mi.Z_PK = m.ZMEDIAITEM`
- `ZMEDIALOCALPATH` on ZWAMEDIAITEM provides absolute file path for media retrieval
- All tools annotated with `readOnlyHint: true` (MCP-02)

### Integration Points
- `src/index.ts` main() — new tools registered alongside existing tools
- `DatabaseHandle.db` — better-sqlite3 instance for ChatStorage.sqlite queries
- ContactsV2.sqlite — second database connection needed for `get_contact` (new integration point)
- WhatsApp media files on disk — accessed via `ZMEDIALOCALPATH` for `get_media_file`

</code_context>

<specifics>
## Specific Ideas

- LIKE-only search chosen over FTS5+LIKE hybrid because FTS5 covers only 21% of messages, making the fallback mandatory anyway — simpler code with identical coverage
- Base64 with 5 MB gate balances Claude being able to view images directly vs not overloading responses with large files
- Missing media returns metadata (not error) so Claude knows what was shared even when the file is gone
- Group member list includes names (not just count or full profiles) — right level of detail for Claude to identify participants

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-extended-tools*
*Context gathered: 2026-04-08*
