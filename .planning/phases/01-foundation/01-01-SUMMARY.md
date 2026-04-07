---
phase: 01-foundation
plan: "01"
subsystem: foundation
tags:
  - typescript
  - config
  - utilities
  - project-setup
dependency_graph:
  requires: []
  provides:
    - package.json with all runtime and dev dependencies
    - tsconfig.json with Node16 module configuration
    - src/config/loader.ts (loadConfig, Config)
    - src/utils/time.ts (appleEpochToISO, APPLE_EPOCH_OFFSET_SECONDS)
  affects:
    - All subsequent plans depend on this foundation
tech_stack:
  added:
    - "@modelcontextprotocol/sdk@1.29.0"
    - "better-sqlite3@12.8.0"
    - "zod@^3.25"
    - "smol-toml@1.6.1"
    - "typescript@^5"
    - "@types/node"
    - "@types/better-sqlite3"
    - "tsx"
  patterns:
    - Node16 module/moduleResolution for ESM + .js import paths
    - smol-toml for TOML config file parsing
    - node:test built-in test runner with tsx/esm import
    - Environment variables override TOML values (D-10 pattern)
key_files:
  created:
    - package.json
    - tsconfig.json
    - .gitignore
    - src/utils/time.ts
    - src/utils/time.test.ts
    - src/config/loader.ts
    - src/config/loader.test.ts
  modified: []
decisions:
  - "Used smol-toml@1.6.1 per RESEARCH.md recommendation over @iarna/toml (abandoned)"
  - "tsconfig module: Node16 required for @modelcontextprotocol/sdk .js ESM imports"
  - "tsx installed as dev dep for node --import tsx/esm test running (not globally available)"
  - "Exact versions pinned for @modelcontextprotocol/sdk and better-sqlite3 per plan spec"
metrics:
  duration: "2 minutes"
  completed: "2026-04-07"
  tasks_completed: 2
  files_created: 7
  files_modified: 0
---

# Phase 01 Plan 01: Project Initialization and Foundation Utilities Summary

TypeScript project scaffolded from scratch with all dependencies installed, tsconfig.json with Node16 module configuration, TOML+env-var config loader with env-wins precedence, and Apple Core Data epoch-to-ISO conversion utility verified against live WhatsApp data.

## What Was Built

### Task 1: Project initialization (commit: 26022d6)

- `package.json` configured with `"type": "module"`, `"engines": { "node": ">=20" }`, and all runtime/dev dependencies at specified versions
- `tsconfig.json` with `"module": "Node16"` and `"moduleResolution": "Node16"` — required for MCP SDK imports using `.js` extensions
- `.gitignore` covering `node_modules/`, `build/`, `*.js.map`
- All 127 npm packages installed successfully

### Task 2: Config loader and timestamp utility (commits: 811c0d9, 7402474)

**TDD Cycle:**
- RED: Wrote 10 failing tests covering all specified behaviors for both modules
- GREEN: Implemented both modules; all 10 tests pass
- No REFACTOR step needed — implementation was clean

**src/utils/time.ts:**
- `APPLE_EPOCH_OFFSET_SECONDS = 978307200` — verified against live WhatsApp message `797271288 → 2026-04-07T16:14:48.000Z`
- `appleEpochToISO(ts)` returns null for null/0 inputs, ISO 8601 string otherwise

**src/config/loader.ts:**
- `loadConfig(configPath?)` accepts optional override config path (useful for testing)
- Reads TOML using `import { parse } from "smol-toml"` — ESM named import works with Node16 module mode
- Maps TOML snake_case keys (`db_path`, `mode`) to Config camelCase interface
- Validates mode values — only accepts "snapshot" | "live", falls back to default if invalid
- Environment variables (`WHATSAPP_DB_PATH`, `WHATSAPP_DB_MODE`) override TOML per D-10

## Verification Results

- `npx tsc --noEmit` — exits 0, no TypeScript errors
- `node --import tsx/esm --test src/utils/time.test.ts src/config/loader.test.ts` — 10/10 pass, 0 fail
- `grep -r "console.log" src/` — no matches (MCP-03 compliant)

## Deviations from Plan

None — plan executed exactly as written.

The only minor note: npm auto-added `^` prefix to dependency versions on `npm install`. Fixed by editing package.json to use exact `1.29.0` and `12.8.0` versions per acceptance criteria before re-running install.

## Known Stubs

None — both modules are fully implemented with no placeholder values or TODO comments.

## Self-Check: PASSED

Files exist:
- package.json: FOUND
- tsconfig.json: FOUND
- src/utils/time.ts: FOUND
- src/config/loader.ts: FOUND
- src/utils/time.test.ts: FOUND
- src/config/loader.test.ts: FOUND

Commits exist:
- 26022d6: FOUND (chore: initialize project)
- 811c0d9: FOUND (test: RED phase tests)
- 7402474: FOUND (feat: GREEN phase implementation)
