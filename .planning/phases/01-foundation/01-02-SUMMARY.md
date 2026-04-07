---
phase: 01-foundation
plan: "02"
subsystem: database
tags:
  - sqlite
  - snapshot
  - validation
  - connection-factory
dependency_graph:
  requires:
    - 01-01 (Config interface from src/config/loader.ts)
  provides:
    - src/db/snapshot.ts (createSnapshot, cleanOldSnapshots, SNAPSHOT_DIR, getSnapshotPath)
    - src/db/validate.ts (validateSchema, REQUIRED_TABLES)
    - src/db/connection.ts (openDatabase, refreshSnapshot, DatabaseHandle)
  affects:
    - 01-03 (MCP server uses openDatabase and refreshSnapshot)
tech_stack:
  added: []
  patterns:
    - better-sqlite3 .backup() for WAL-safe atomic snapshot creation
    - readonly + fileMustExist + timeout:0 for fail-fast live DB access
    - sqlite_master query for startup schema validation
    - process.stderr.write() for all output (no console.log)
    - process.exit(1) fail-fast on unrecoverable startup errors
key_files:
  created:
    - src/db/snapshot.ts
    - src/db/validate.ts
    - src/db/connection.ts
  modified: []
decisions:
  - "getSnapshotPath unused import removed from connection.ts (cleanliness auto-fix)"
  - "refreshSnapshot does not call cleanOldSnapshots — only creates a fresh overwrite in-place (refresh differs from startup)"
metrics:
  duration: "2 minutes"
  completed: "2026-04-07"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 01 Plan 02: Database Access Layer Summary

Three database modules implementing WAL-safe snapshot creation via better-sqlite3 `.backup()`, startup schema validation against sqlite_master, and a connection factory supporting both snapshot (default) and live modes with SQLITE_BUSY fail-fast behavior.

## What Was Built

### Task 1: Snapshot lifecycle and schema validation (commit: 23c4a33)

**src/db/snapshot.ts:**
- `SNAPSHOT_DIR = path.join(os.tmpdir(), "whatsapp-mcp")` — consistent temp storage per D-03
- `cleanOldSnapshots()` — wipes all files in SNAPSHOT_DIR on startup per D-04; creates dir if missing
- `createSnapshot(liveDbPath)` — opens live DB with `readonly: true, fileMustExist: true, timeout: 0`, calls `.backup(snapshotPath)` for WAL-safe atomic copy, closes connection in finally block
- TCC/SQLITE_CANTOPEN detection with actionable "Grant Full Disk Access" error per D-05, D-07

**src/db/validate.ts:**
- `REQUIRED_TABLES = ["ZWAMESSAGE", "ZWACHATSESSION", "ZWAMEDIAITEM", "ZWAPROFILEPUSHNAME"]`
- `validateSchema(db)` — queries `sqlite_master WHERE type='table'`, finds missing tables, exits with actionable error per D-07

### Task 2: Database connection factory (commit: 5e6afb4)

**src/db/connection.ts:**
- `DatabaseHandle` interface: `{ db, mode, snapshotPath }`
- `openDatabase(config)` — snapshot mode: cleanOldSnapshots + createSnapshot + open copy + validateSchema; live mode: existsSync check + open with timeout:0 + validateSchema
- `refreshSnapshot(config, currentHandle)` — closes current DB, creates new snapshot, re-validates
- Outer try/catch catches SQLITE_BUSY with actionable error; all other errors exit with message
- All output via `process.stderr.write()` — zero `console.log`

## Verification Results

- `npx tsc --noEmit` — exits 0, no TypeScript errors
- `grep -r "console.log" src/` — no matches (MCP-03 compliant)
- `grep "\.backup(" src/db/snapshot.ts` — WAL-safe copy call confirmed
- `grep "REQUIRED_TABLES" src/db/validate.ts` — table list confirmed
- `grep "timeout: 0" src/db/connection.ts` — live mode fail-fast confirmed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused getSnapshotPath import from connection.ts**
- **Found during:** Post-task review before SUMMARY creation
- **Issue:** `getSnapshotPath` was imported in connection.ts but never used (the connection factory uses `createSnapshot` which calls `getSnapshotPath` internally)
- **Fix:** Removed `getSnapshotPath` from the import statement in connection.ts
- **Files modified:** src/db/connection.ts
- **Commit:** included in 5e6afb4 (fix applied before commit tracking, discovered during review)

## Known Stubs

None — all three modules are fully implemented. No placeholder values, TODO comments, or stub functions.

## Self-Check: PASSED

Files exist:
- src/db/snapshot.ts: FOUND
- src/db/validate.ts: FOUND
- src/db/connection.ts: FOUND

Commits exist:
- 23c4a33: FOUND (feat(01-02): add snapshot lifecycle and schema validation modules)
- 5e6afb4: FOUND (feat(01-02): add database connection factory)
