---
phase: 02-core-tools
verified: 2026-04-07T21:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
human_verification:
  - test: "list_chats returns meaningful contact names from live WhatsApp DB"
    expected: "Names resolved via push_name fallback chain, not raw JIDs"
    why_human: "Cannot query live WhatsApp SQLite DB in CI — name resolution requires real data"
  - test: "get_messages_since polling workflow end-to-end"
    expected: "Claude calls get_messages_since with a timestamp and receives messages grouped by chat"
    why_human: "Requires Claude Desktop connection to a live or snapshot WhatsApp database"
---

# Phase 2: Core Tools Verification Report

**Phase Goal:** Claude can list all WhatsApp chats and read messages from any chat — including polling for messages since a given timestamp — covering the primary personal assistant use case
**Verified:** 2026-04-07T21:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `list_chats` returns all chats with name, chat ID, unread count, last message preview, last message timestamp, and chat type | VERIFIED | `list-chats.ts` queries ZWACHATSESSION with LEFT JOIN to ZWAPROFILEPUSHNAME; maps all fields; JSON envelope `{chats, total}` |
| 2  | Contact names resolved via ZWAPROFILEPUSHNAME with fallback chain (push_name > partner_name > contact_name > jid) | VERIFIED | Line 78-84 of `list-chats.ts`: `row.push_name ?? row.partner_name ?? row.contact_name ?? row.jid ?? "Unknown"` |
| 3  | Chats sorted by most recent message first | VERIFIED | SQL: `ORDER BY cs.ZLASTMESSAGEDATE DESC` present in `list-chats.ts` line 42 |
| 4  | `isoToAppleEpoch` utility exists and correctly converts ISO 8601 to Apple Core Data epoch | VERIFIED | `src/utils/time.ts` line 8-10; spot-check: `isoToAppleEpoch("2025-01-01T00:00:00.000Z")` returns `757382400` (correct) |
| 5  | Claude can call `get_messages` with a chat ID and receive messages with sender name, timestamp, text, message type, media metadata, and is_from_me flag | VERIFIED | `get-messages.ts` queries ZWAMESSAGE LEFT JOIN ZWAMEDIAITEM; maps all required fields including `is_from_me === 1` boolean conversion |
| 6  | `get_messages` supports optional date range (since/before) and limit parameters with 50 default and 1000 hard cap | VERIFIED | Zod schema: `limit: z.number().int().min(1).max(1000).default(50).optional()`; `effectiveLimit = Math.min(args.limit ?? 50, 1000)`; sinceApple/beforeApple param binding |
| 7  | Claude can call `get_messages_since` with an ISO 8601 timestamp and receive all new messages grouped by chat | VERIFIED | `get-messages-since.ts` uses `isoToAppleEpoch(args.since)` for SQL binding; groups results via `Map<number, {chat_id, chat_name, messages[]}>` |
| 8  | Both `get_messages` and `get_messages_since` return `has_more` flag and `next_cursor` when 1000 message cap is hit | VERIFIED | Both tools use fetch-limit+1 pattern; `has_more = rows.length > effectiveLimit/CAP`; `next_cursor = appleEpochToISO(...)` |
| 9  | All three Phase 2 tools are wired into `src/index.ts` and accessible via MCP | VERIFIED | `src/index.ts` imports and calls `registerListChatsTool`, `registerGetMessagesTool`, `registerGetMessagesSinceTool` alongside existing `registerRefreshSnapshotTool` |

**Score:** 9/9 truths verified (5 plan must-have truths plus 4 sub-truths derived from Success Criteria — all pass)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/time.ts` | `isoToAppleEpoch`, `MESSAGE_TYPE_MAP`, `resolveMessageType` exports | VERIFIED | All 4 exports present: `APPLE_EPOCH_OFFSET_SECONDS`, `appleEpochToISO`, `isoToAppleEpoch`, `MESSAGE_TYPE_MAP`, `resolveMessageType`. 27 lines, fully substantive. |
| `src/tools/list-chats.ts` | `registerListChatsTool` export with working MCP tool | VERIFIED | 114 lines. Exports `registerListChatsTool`. Registers `list_chats` with MCP server. Real SQL query, real mapping, real error handling. |
| `src/tools/get-messages.ts` | `registerGetMessagesTool` export with working MCP tool | VERIFIED | 157 lines. Exports `registerGetMessagesTool`. Registers `get_messages`. Full implementation: SQL, param binding, pagination, media mapping. |
| `src/tools/get-messages-since.ts` | `registerGetMessagesSinceTool` export with working MCP tool | VERIFIED | 167 lines. Exports `registerGetMessagesSinceTool`. Registers `get_messages_since`. Cross-chat query with grouping via Map. |
| `src/index.ts` | All four tools registered | VERIFIED | Lines 6-8: three new imports. Lines 26-28: three new registrations alongside existing `registerRefreshSnapshotTool`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/list-chats.ts` | `src/utils/time.ts` | imports `appleEpochToISO` | WIRED | Line 4: `import { appleEpochToISO } from "../utils/time.js"`. Used at line 87 for `last_message_at`. |
| `src/tools/list-chats.ts` | `DatabaseHandle.db` | `getState().handle.db.prepare(...)` | WIRED | Line 59: `handle.db.prepare(LIST_CHATS_SQL).all()` |
| `src/tools/get-messages.ts` | `src/utils/time.ts` | imports `isoToAppleEpoch`, `appleEpochToISO`, `resolveMessageType` | WIRED | Line 3: all three imported. Used at lines 68, 69, 83, 110, 112. |
| `src/tools/get-messages-since.ts` | `src/utils/time.ts` | imports `isoToAppleEpoch`, `appleEpochToISO`, `resolveMessageType` | WIRED | Line 3: all three imported. Used at lines 68, 78, 119, 121. |
| `src/index.ts` | `src/tools/list-chats.ts` | import and call `registerListChatsTool(server, getState)` | WIRED | Line 6 (import), line 26 (call). |
| `src/index.ts` | `src/tools/get-messages.ts` | import and call `registerGetMessagesTool(server, getState)` | WIRED | Line 7 (import), line 27 (call). |
| `src/index.ts` | `src/tools/get-messages-since.ts` | import and call `registerGetMessagesSinceTool(server, getState)` | WIRED | Line 8 (import), line 28 (call). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `list-chats.ts` | `rows` (ChatSessionRow[]) | `handle.db.prepare(LIST_CHATS_SQL).all()` — queries ZWACHATSESSION | Yes — live DB query, no static fallback | FLOWING |
| `get-messages.ts` | `rows` (MessageRow[]) | `handle.db.prepare(GET_MESSAGES_SQL).all(...)` — queries ZWAMESSAGE | Yes — parameterized query with real bindings | FLOWING |
| `get-messages-since.ts` | `rows` (CrossChatRow[]) | `handle.db.prepare(GET_MESSAGES_SINCE_SQL).all(sinceApple, CAP+1)` | Yes — parameterized cross-chat query | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `isoToAppleEpoch("2025-01-01T00:00:00.000Z")` returns `757382400` | `node -e` inline check | `757382400` | PASS |
| `resolveMessageType(0)` returns `"text"` | `node -e` inline check | `"text"` | PASS |
| `resolveMessageType(14)` returns `"system"` | `node -e` inline check | `"system"` | PASS |
| `resolveMessageType(999)` returns `"unknown(999)"` | `node -e` inline check | `"unknown(999)"` | PASS |
| TypeScript compilation (`tsc --noEmit`) | `npx tsc --noEmit` | No output (zero errors) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TOOL-01 | 02-01-PLAN.md | `list_chats` returns all chats with contact/group name, last message preview, unread count, and chat ID | SATISFIED | `src/tools/list-chats.ts` implements full query; all fields present in response. Note: REQUIREMENTS.md traceability table still shows "Pending" — stale doc, not an implementation gap. |
| TOOL-02 | 02-02-PLAN.md | `get_messages` returns messages from a specific chat with optional date range and limit filters | SATISFIED | `src/tools/get-messages.ts` implements full per-chat retrieval with since/before/limit params. REQUIREMENTS.md correctly shows "Complete". |
| TOOL-03 | 02-02-PLAN.md | `get_messages_since` returns messages across all chats since a given timestamp (for polling) | SATISFIED | `src/tools/get-messages-since.ts` implements cross-chat polling with grouping by chat. REQUIREMENTS.md correctly shows "Complete". |

**Note on REQUIREMENTS.md:** TOOL-01 is implemented but REQUIREMENTS.md still has `[ ]` (unchecked) and "Pending" status in the traceability table. This is a stale documentation issue — the code is complete. REQUIREMENTS.md should be updated to mark TOOL-01 as complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TODO/FIXME/placeholder/stub patterns found in any Phase 2 tool files | — | — |

No forbidden columns (`ZMUTED`, `ZPINNED`, `participant_count`) found in any tool file. No empty returns, no hardcoded arrays, no console.log-only handlers.

### Human Verification Required

#### 1. Contact Name Resolution from Live Database

**Test:** Connect Claude Desktop to the MCP server with a real WhatsApp database snapshot. Call `list_chats`. Check that chat names are human-readable (e.g., "Alice Smith") rather than raw JIDs (e.g., "15551234567@s.whatsapp.net").
**Expected:** Names resolved via push_name fallback chain; at least some chats show human names.
**Why human:** Cannot access live or snapshot WhatsApp SQLite database in verification environment.

#### 2. Polling Workflow End-to-End

**Test:** Call `get_messages_since` with a timestamp from 1 hour ago. Verify the response contains messages grouped under chat objects with `chat_id`, `chat_name`, and `messages` arrays.
**Expected:** Response JSON matches `{ chats: [{chat_id: N, chat_name: "...", messages: [...]}], total_messages: N, has_more: false, next_cursor: null }`.
**Why human:** Requires live Claude Desktop connection and real WhatsApp message data.

### Gaps Summary

No gaps. All must-have truths verified, all artifacts exist and are substantive, all key links are wired, data flows from real DB queries to tool responses. TypeScript compiles cleanly. The only documentation issue is REQUIREMENTS.md still marking TOOL-01 as "Pending" — this should be updated but does not block phase completion.

---

_Verified: 2026-04-07T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
