---
phase: 02-core-tools
plan: 02
subsystem: api
tags: [sqlite, mcp, whatsapp, typescript, better-sqlite3, pagination]

# Dependency graph
requires:
  - phase: 02-core-tools
    plan: 01
    provides: isoToAppleEpoch, resolveMessageType, DatabaseHandle interface, registerXxxTool pattern

provides:
  - get_messages MCP tool (TOOL-02) with per-chat retrieval, date filtering, and pagination
  - get_messages_since MCP tool (TOOL-03) with cross-chat polling grouped by chat
  - All 4 Phase 2 tools wired into src/index.ts

affects:
  - Phase 3 search tool (will follow same LEFT JOIN ZWAMEDIAITEM pattern)
  - src/index.ts — now exposes all core read tools to MCP clients

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pagination via fetch LIMIT+1 — if rows.length > cap, has_more=true, next_cursor=appleEpochToISO(lastRow.message_date)"
    - "ISO-to-Apple-epoch conversion via isoToAppleEpoch before SQL binding (Pitfall 1 guard)"
    - "LEFT JOIN ZWAMEDIAITEM (not INNER JOIN) to preserve messages without media (Pitfall 2 guard)"
    - "Media object only included when media_path or media_title or media_file_size is truthy (D-10)"
    - "Cross-chat grouping via Map<number, {chat_id, chat_name, messages[]}> in memory post-query"
    - "is_from_me stored as SQLite integer — converted to boolean (=== 1) before serialization"

key-files:
  created:
    - src/tools/get-messages.ts
    - src/tools/get-messages-since.ts
  modified:
    - src/index.ts

key-decisions:
  - "tsup not in project — build uses tsc directly; plan's tsup verification replaced with tsc + native build (no deviation to plan logic)"
  - "get_messages_since uses JOIN (not LEFT JOIN) for ZWACHATSESSION — messages must belong to a chat session to be meaningful"
  - "Both tools use identical media object shape: {filename, file_size} — consistent with list-chats pattern"

requirements-completed: [TOOL-02, TOOL-03]

# Metrics
duration: ~5min
completed: 2026-04-07
---

# Phase 2 Plan 02: get_messages and get_messages_since Tools Summary

**get_messages and get_messages_since MCP tools implementing per-chat retrieval with date filtering and cross-chat polling grouped by chat, wired alongside list_chats and refresh_snapshot into src/index.ts**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-07T20:34:32Z
- **Completed:** 2026-04-07T20:39:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Created `src/tools/get-messages.ts` implementing TOOL-02 — `get_messages` MCP tool
  - Per-chat message retrieval from ZWAMESSAGE with LEFT JOIN ZWAMEDIAITEM
  - Optional since/before date filtering with ISO-to-Apple-epoch conversion
  - Default limit 50, hard cap 1000 enforced via Math.min()
  - Pagination via fetch-limit+1 pattern: has_more + next_cursor

- Created `src/tools/get-messages-since.ts` implementing TOOL-03 — `get_messages_since` MCP tool
  - Cross-chat polling — all messages since a required ISO 8601 timestamp
  - JOINs ZWACHATSESSION (required) + ZWAPROFILEPUSHNAME + ZWAMEDIAITEM (both LEFT JOIN)
  - Results grouped in memory by chat using Map<number, ...>
  - 1000 message hard cap with has_more + next_cursor pagination

- Updated `src/index.ts` to register all four tools: refresh_snapshot, list_chats, get_messages, get_messages_since

- Project compiles cleanly with tsc and produces build/index.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Create get_messages MCP tool (TOOL-02)** - `acd7069` (feat)
2. **Task 2: Create get_messages_since MCP tool (TOOL-03)** - `29127fb` (feat)
3. **Task 3: Wire all Phase 2 tools into src/index.ts** - `1a7c7c5` (feat)

## Files Created/Modified

- `src/tools/get-messages.ts` — `get_messages` MCP tool: per-chat retrieval, date filtering, pagination, media metadata
- `src/tools/get-messages-since.ts` — `get_messages_since` MCP tool: cross-chat polling, chat grouping, pagination
- `src/index.ts` — Added 3 new tool imports and registrations

## Decisions Made

- `tsc` used for build verification instead of `tsup` (tsup not installed in project; package.json build script uses `tsc`)
- `get_messages_since` uses a regular JOIN for ZWACHATSESSION (not LEFT JOIN) — messages without a chat session are not meaningful to return
- Both tools share the same media object shape `{filename, file_size}` for consistency

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written with one minor adaptation:

**Build verification (Task 3):** Plan specified `npx tsup src/index.ts --format cjs --outDir dist`. The project's package.json does not have tsup as a dependency; it uses `tsc` with `outDir: build`. Used `tsc` build instead — behavior equivalent (TypeScript compilation verified, output JS produced). Not a logic deviation.

## Known Stubs

None — both tools query live data from WhatsApp SQLite tables. No hardcoded or placeholder data.

## User Setup Required

None — tools use the existing database connection established at server startup.

## Next Phase Readiness

- All four Phase 2 MCP tools operational: refresh_snapshot, list_chats, get_messages, get_messages_since
- Phase 3 (search) will follow the same LEFT JOIN ZWAMEDIAITEM pattern established here
- Build pipeline confirmed: tsc compiles all tools, produces build/index.js

## Self-Check: PASSED

- src/tools/get-messages.ts: FOUND
- src/tools/get-messages-since.ts: FOUND
- src/index.ts: MODIFIED (4 tool registrations present)
- Commit acd7069: FOUND (Task 1 — get_messages)
- Commit 29127fb: FOUND (Task 2 — get_messages_since)
- Commit 1a7c7c5: FOUND (Task 3 — index.ts wiring)

---
*Phase: 02-core-tools*
*Completed: 2026-04-07*
