# Phase 2: Core Tools - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Three MCP tools (`list_chats`, `get_messages`, `get_messages_since`) that let Claude list all WhatsApp chats and read messages from any chat — including polling for messages since a given timestamp — covering the primary personal assistant use case.

</domain>

<decisions>
## Implementation Decisions

### Response Content
- **D-01:** `list_chats` returns kitchen sink: chat ID, contact/group name, last message preview, last message timestamp, unread count, chat type (individual/group), participant count, muted status, pinned status
- **D-02:** `get_messages` returns full context per message: sender name, timestamp, text content, message type indicator (text/image/video/voice/doc), media filename if present, is_from_me flag
- **D-03:** All tool responses use structured JSON format (not human-readable text or hybrid)
- **D-04:** Contact name resolution JOINs ZWAPROFILEPUSHNAME for display names (not just raw chat session name)

### Default Behaviors
- **D-05:** `get_messages` default limit is 50 messages when no limit specified
- **D-06:** `list_chats` sorted by most recent message first (matches WhatsApp's own ordering)
- **D-07:** Hard max cap of 1000 messages on all tools, even when caller specifies higher
- **D-08:** When cap is hit, response includes `has_more: true` and the timestamp of the last message returned, enabling cursor-based pagination via follow-up calls
- **D-09:** Empty results return normal JSON structure with empty array plus a brief text note (e.g., "No messages found in this range")

### Message Types
- **D-10:** Media messages (images, voice notes, documents) show type + metadata: message type, filename, file size, and any caption text — enough for Claude to know what was shared without fetching the file
- **D-11:** System messages (group joins/leaves, name changes, encryption notices) included with a 'system' message type flag — Claude can filter if needed

### Polling Design
- **D-12:** `get_messages_since` groups results by chat — each chat has name/ID and an array of messages since the timestamp
- **D-13:** `get_messages_since` accepts ISO 8601 string as timestamp input (consistent with INFRA-04 output format)
- **D-14:** `get_messages_since` requires the `since` timestamp parameter — no default lookback window
- **D-15:** Same 1000 message cap applies to `get_messages_since`, with `has_more` + last timestamp pagination

### Claude's Discretion
- Module/file organization for new tool files (follow the pattern from `refresh-snapshot.ts`)
- SQL query structure and JOIN strategy for resolving names, media metadata
- How to detect message type from the ZWAMESSAGE schema fields

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `CLAUDE.md` — Tech stack decisions, library versions, WhatsApp database location and table names (ZWAMESSAGE, ZWAMEDIAITEM, ZWACHATSESSION, ZWAPROFILEPUSHNAME), version compatibility
- `.planning/REQUIREMENTS.md` — TOOL-01, TOOL-02, TOOL-03 define this phase's requirements with acceptance criteria
- `.planning/ROADMAP.md` — Phase 2 success criteria and scope boundary

### Phase 1 Foundation
- `src/tools/refresh-snapshot.ts` — Established tool registration pattern (registerXTool with server, getState, setState)
- `src/db/connection.ts` — DatabaseHandle interface, getState/setState closure pattern
- `src/utils/time.ts` — `appleEpochToISO()` timestamp conversion utility
- `src/index.ts` — Tool wiring in main() function
- `src/server.ts` — MCP server factory

### Prior Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions (snapshot lifecycle, error messaging, config design)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `appleEpochToISO()` in `src/utils/time.ts` — converts Apple Core Data timestamps to ISO 8601
- `registerRefreshSnapshotTool()` in `src/tools/refresh-snapshot.ts` — template for new tool registration
- `DatabaseHandle` interface in `src/db/connection.ts` — provides `db` (better-sqlite3 instance) for queries
- `getState`/`setState` closure pattern in `src/index.ts` — shared state access for all tools

### Established Patterns
- Tool registration: `registerXTool(server, getState, setState)` function per tool file
- MCP responses: `{ content: [{ type: "text", text: "..." }] }` with optional `isError: true`
- All tools annotated with `readOnlyHint: true` (MCP-02)
- Errors returned as MCP error responses (D-06 from Phase 1), not thrown

### Integration Points
- `src/index.ts` main() — new tools registered alongside `registerRefreshSnapshotTool`
- `DatabaseHandle.db` — better-sqlite3 instance for running SQL queries
- WhatsApp tables: ZWACHATSESSION (chats), ZWAMESSAGE (messages), ZWAMEDIAITEM (media), ZWAPROFILEPUSHNAME (names)

</code_context>

<specifics>
## Specific Ideas

- User wants maximum detail from list_chats (kitchen sink approach) — chat type, participant count, muted/pinned status all included
- Cap at 1000 (not 500) — user prefers higher ceiling with pagination safety net
- Timestamp as pagination cursor: when cap hit, return `has_more` flag + last message timestamp so Claude can page through with follow-up calls
- Require explicit timestamp for polling — no magic default lookback window

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-core-tools*
*Context gathered: 2026-04-07*
