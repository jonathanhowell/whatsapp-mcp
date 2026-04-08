---
phase: 03-extended-tools
plan: 01
subsystem: tools
tags: [search, group-chat, mcp-tools, sqlite, pagination]
dependency_graph:
  requires: [02-01, 02-02]
  provides: [search_messages-tool, get_chat-tool]
  affects: [src/index.ts]
tech_stack:
  added: []
  patterns: [LIKE-search-with-cursor-pagination, two-query-group-chat]
key_files:
  created:
    - src/tools/search-messages.ts
    - src/tools/get-chat.ts
  modified: []
decisions:
  - LIKE-only search (no FTS5) per D-01 — FTS5 covers only ~4711 of 22892 messages
  - Cursor pagination uses descending ZMESSAGEDATE with < operator
  - get_chat uses two-query pattern: chat row first, then members only for groups
metrics:
  duration: "~2 minutes"
  completed: "2026-04-08"
  tasks_completed: 2
  files_changed: 2
---

# Phase 03 Plan 01: Search Messages and Get Chat Tools Summary

LIKE-based keyword search across all chats with cursor pagination, plus group-aware chat detail tool using two-query approach for ZWAGROUPMEMBER lookup.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create search_messages tool | a0ad357 | src/tools/search-messages.ts |
| 2 | Create get_chat tool | 9ff4172 | src/tools/get-chat.ts |

## What Was Built

### search_messages tool (`src/tools/search-messages.ts`)

- Exports `registerSearchMessagesTool(server, getState)`
- LIKE-only search on `ZTEXT` with `ESCAPE '\\'` clause (no FTS5, per D-01)
- Escapes `%`, `_`, and `\` in query input before binding as `%...%` pattern
- Returns messages grouped by chat using the `chatMap` pattern from `get-messages-since.ts`
- Cursor pagination: `CAP = 1000`, fetches `CAP + 1` rows to detect `has_more`
- Cursor converts ISO timestamp to Apple epoch and adds `AND ZMESSAGEDATE < ?` for descending traversal
- Response: `{ chats, total_messages, has_more, next_cursor }`
- Full message text returned per D-03

### get_chat tool (`src/tools/get-chat.ts`)

- Exports `registerGetChatTool(server, getState)`
- Two-query approach: first fetches chat row with LEFT JOIN to ZWAGROUPINFO, then conditionally fetches ZWAGROUPMEMBER only when `session_type === 1`
- `SESSION_TYPE_MAP` maps 0=individual, 1=group, 2=broadcast, 3=status
- `group_info: null` for non-group chats
- For group chats: populates `owner_jid`, `creator_jid`, `created_at`, `member_count`, `members[]`
- Members filtered with `ZISACTIVE = 1` to exclude removed members
- `display_name` from `COALESCE(gm.ZCONTACTNAME, ppn.ZPUSHNAME)` — documented `null` limitation for @lid JIDs

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Both tools are fully wired to the database schema with no placeholder values.

## Verification

- `npx tsc --noEmit` passes with zero errors after both files created
- Both files export correct function signatures: `(server: McpServer, getState: () => { config: Config; handle: DatabaseHandle }) => void`
- Both use `readOnlyHint: true`
- `search-messages.ts` uses LIKE not FTS5
- `get-chat.ts` conditionally queries ZWAGROUPMEMBER only for groups

## Self-Check: PASSED

- src/tools/search-messages.ts: FOUND
- src/tools/get-chat.ts: FOUND
- Commit a0ad357: FOUND
- Commit 9ff4172: FOUND
