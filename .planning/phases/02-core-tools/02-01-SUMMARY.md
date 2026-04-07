---
phase: 02-core-tools
plan: 01
subsystem: api
tags: [sqlite, mcp, whatsapp, typescript, better-sqlite3]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: DatabaseHandle interface, getState/setState closure pattern, registerTool conventions

provides:
  - list_chats MCP tool (TOOL-01) querying ZWACHATSESSION with push name resolution
  - isoToAppleEpoch utility for ISO-to-Apple-epoch conversion (used by Plan 02)
  - MESSAGE_TYPE_MAP and resolveMessageType for ZMESSAGETYPE decoding (used by Plan 02)

affects:
  - 02-02 (get_messages uses isoToAppleEpoch for since-timestamp filtering and resolveMessageType for message type labels)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "registerXxxTool(server, getState) — read-only tools omit setState parameter"
    - "Push name fallback chain: push_name ?? partner_name ?? contact_name ?? jid ?? 'Unknown'"
    - "LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID for contact names"
    - "Apple epoch arithmetic: Unix seconds minus APPLE_EPOCH_OFFSET_SECONDS (978307200)"

key-files:
  created:
    - src/tools/list-chats.ts
  modified:
    - src/utils/time.ts

key-decisions:
  - "list_chats omits muted/pinned/participant_count — columns unverified in live DB schema (deferred per research open questions)"
  - "registerListChatsTool does not take setState — list_chats is read-only and causes no state mutation"

patterns-established:
  - "Read-only tools: registerXxxTool(server, getState) — no setState needed"
  - "Tool response: JSON.stringify to single text content item"
  - "Error response: isError: true with descriptive message"

requirements-completed: [TOOL-01]

# Metrics
duration: 1min
completed: 2026-04-07
---

# Phase 2 Plan 01: list_chats Tool and Time Utilities Summary

**list_chats MCP tool querying ZWACHATSESSION with ZWAPROFILEPUSHNAME join for resolved contact names, plus isoToAppleEpoch and resolveMessageType utilities for Plan 02**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-04-07T20:32:36Z
- **Completed:** 2026-04-07T20:34:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `isoToAppleEpoch`, `MESSAGE_TYPE_MAP`, and `resolveMessageType` to `src/utils/time.ts` for use by Plans 02+
- Created `src/tools/list-chats.ts` implementing TOOL-01 — the `list_chats` MCP tool
- Tool returns all chats sorted by most recent message, with resolved contact names via 4-level fallback chain
- TypeScript compiles cleanly, no forbidden columns (ZMUTED/ZPINNED/participant_count omitted per research)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add shared utilities to time.ts** - `cd66960` (feat)
2. **Task 2: Create list_chats MCP tool (TOOL-01)** - `670e0fb` (feat)

## Files Created/Modified

- `src/utils/time.ts` — Added `isoToAppleEpoch`, `MESSAGE_TYPE_MAP`, `resolveMessageType` (existing exports unchanged)
- `src/tools/list-chats.ts` — `list_chats` MCP tool with ZWACHATSESSION query, name resolution, and error handling

## Decisions Made

- `registerListChatsTool` omits `setState` parameter — list_chats causes no state mutation (read-only tools follow this pattern)
- Muted/pinned/participant_count columns omitted — columns not confirmed in live schema (research open questions Q1/Q2); deferred to future plan if needed
- Empty result returns `{ chats: [], total: 0, note: "No chats found" }` per D-09

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npx tsx -e` eval mode could not resolve relative imports from `[eval]` file path — resolved by using an absolute import path in a temp file for verification. TypeScript compilation (`tsc --noEmit`) used as primary acceptance check.

## Known Stubs

None — `list_chats` queries live data from `ZWACHATSESSION` table. No hardcoded or placeholder data.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `isoToAppleEpoch` and `resolveMessageType` are ready for Plan 02 (get_messages/get_messages_since)
- `list_chats` provides the chat_id values that Plan 02 uses to filter by chat
- Pattern established: read-only tool registration with `getState` only (no setState)

---
*Phase: 02-core-tools*
*Completed: 2026-04-07*
