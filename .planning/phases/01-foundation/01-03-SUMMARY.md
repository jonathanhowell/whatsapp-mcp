---
phase: 01-foundation
plan: 03
subsystem: api
tags: [mcp, stdio, typescript, whatsapp, sqlite]

# Dependency graph
requires:
  - phase: 01-01
    provides: loadConfig(), TOML config loader, env path utilities
  - phase: 01-02
    provides: openDatabase(), refreshSnapshot(), DatabaseHandle, validateSchema()
provides:
  - MCP server entry point (src/index.ts) wiring config, database, and tools into a stdio server
  - McpServer factory (src/server.ts) with whatsapp-mcp name and version
  - refresh_snapshot MCP tool (src/tools/refresh-snapshot.ts) with readOnlyHint:true
  - Compiled build/index.js registered with Claude Desktop
affects: [02-core-tools, 03-search]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk StdioServerTransport", "@modelcontextprotocol/sdk McpServer"]
  patterns:
    - "Tool registration via server.registerTool() with annotations: { readOnlyHint: true }"
    - "State accessor pattern (getState/setState closures) for mutable handle shared between tools"
    - "All logging via process.stderr.write() — zero stdout pollution"
    - "All relative imports use .js extensions (required by module: Node16)"

key-files:
  created:
    - src/index.ts
    - src/server.ts
    - src/tools/refresh-snapshot.ts
    - build/index.js
  modified: []

key-decisions:
  - "StdioServerTransport used (not HTTP/SSE) — required for Claude Desktop integration"
  - "Tool state shared via getState/setState closure pattern rather than global or class property"
  - "readOnlyHint: true applied to all tools per MCP-02 requirement"
  - "All logging routes to stderr — no stdout writes outside MCP JSON-RPC protocol"

patterns-established:
  - "Tool registration: registerRefreshSnapshotTool(server, getState, setState) — tools receive server + state accessors"
  - "Entry point pattern: loadConfig → openDatabase → createServer → register tools → connect transport"
  - "Error returns use isError: true in MCP content array (not thrown exceptions)"

requirements-completed: [MCP-01, MCP-02, MCP-03]

# Metrics
duration: ~20min
completed: 2026-04-07
---

# Phase 01 Plan 03: MCP Server Entry Point Summary

**stdio MCP server wiring WhatsApp SQLite database to Claude Desktop via refresh_snapshot tool with readOnlyHint:true**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-07T16:20:00Z
- **Completed:** 2026-04-07T17:00:00Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 4 created, 0 modified

## Accomplishments
- McpServer factory (createServer) producing a named whatsapp-mcp v1.0.0 server instance
- refresh_snapshot tool registered with readOnlyHint:true — handles both live mode (no-op) and snapshot mode (calls refreshSnapshot from db layer)
- Entry point connecting config loader, database handle, tool registration, and StdioServerTransport into a single startup sequence
- tsc build producing build/index.js successfully registered with and verified by Claude Desktop

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP server setup, refresh_snapshot tool, and entry point** - `3eefab8` (feat)
2. **Task 2: Verify server works with Claude Desktop** - human-verify checkpoint, approved by user

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/index.ts` — Entry point: loadConfig → openDatabase → createServer → register tools → StdioServerTransport connect
- `src/server.ts` — createServer() factory returning McpServer({ name: "whatsapp-mcp", version: "1.0.0" })
- `src/tools/refresh-snapshot.ts` — registerRefreshSnapshotTool() with readOnlyHint:true, live-mode guard, refreshSnapshot() delegation
- `build/index.js` — Compiled output registered in Claude Desktop claude_desktop_config.json

## Decisions Made
- State for mutable DatabaseHandle shared between tools via getState/setState closure pattern rather than global variable or class instance — keeps tool modules stateless and testable
- refresh_snapshot returns informational text for live mode rather than an error, since live mode is a valid operational state
- All error returns use `isError: true` in MCP content array per SDK convention, not thrown exceptions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. tsc compiled cleanly on first attempt. Claude Desktop recognized refresh_snapshot and the tool executed successfully.

## User Setup Required

None - Claude Desktop config was already updated during Task 1 execution. Server is registered and working.

## Next Phase Readiness

- MCP server foundation complete — Claude Desktop can connect and invoke tools
- Database handle (snapshot or live) is available to all future tools via the getState/setState pattern
- Phase 02 (core tools) can implement list_chats, get_messages, search_messages tools following the same tool registration pattern established here
- No blockers for Phase 02 execution

---
*Phase: 01-foundation*
*Completed: 2026-04-07*

## Self-Check: PASSED

- FOUND: .planning/phases/01-foundation/01-03-SUMMARY.md
- FOUND: src/index.ts
- FOUND: src/server.ts
- FOUND: src/tools/refresh-snapshot.ts
- FOUND: build/index.js
- FOUND: commit 3eefab8
