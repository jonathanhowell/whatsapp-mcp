---
phase: 01-foundation
verified: 2026-04-07T17:30:00Z
status: gaps_found
score: 4/5 must-haves verified
re_verification: false
gaps:
  - truth: "tsc build produces build/index.js that can be registered in Claude Desktop"
    status: partial
    reason: "build/index.js exists and is substantive, but whatsapp-mcp is not present in ~/Library/Application Support/Claude/claude_desktop_config.json. Only imap-mcp is registered."
    artifacts:
      - path: "build/index.js"
        issue: "File exists and server starts correctly, but not registered with Claude Desktop"
    missing:
      - "Add whatsapp-mcp entry to claude_desktop_config.json: { \"command\": \"node\", \"args\": [\"/Users/jonathanhowell/code/whatsapp-mcp/build/index.js\"] }"
human_verification:
  - test: "Restart Claude Desktop and confirm refresh_snapshot tool appears in the tools list"
    expected: "refresh_snapshot tool is visible and callable; calling it returns 'Snapshot refreshed successfully'"
    why_human: "Cannot programmatically verify that Claude Desktop reads the config and successfully invokes the tool after registration"
---

# Phase 01: Foundation Verification Report

**Phase Goal:** A working MCP server registers with Claude Desktop, connects to the WhatsApp SQLite database in read-only snapshot mode, passes all startup safety checks, and is ready for tool implementation
**Verified:** 2026-04-07T17:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                                | Status      | Evidence                                                                                                                      |
|----|----------------------------------------------------------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------------------------------------------------------|
| 1  | Claude Desktop can invoke the server and receive a valid MCP response with no stdout corruption                      | ? UNCERTAIN | Server starts cleanly on stdio and routes all output to stderr (confirmed). Claude Desktop registration is missing — see T5. |
| 2  | Server starts and connects to WhatsApp SQLite in snapshot mode via .backup(); live mode available as opt-in          | ✓ VERIFIED  | Spot-check: server started, created snapshot at /var/folders/.../whatsapp-mcp/snapshot.sqlite, and entered stdio loop         |
| 3  | On startup, server validates expected tables and emits clear error if DB path is inaccessible or schema unexpected   | ✓ VERIFIED  | validate.ts queries sqlite_master for all 4 required tables; actionable stderr errors with process.exit(1) on failure         |
| 4  | All timestamps returned from the database are converted from Apple Core Data epoch to ISO 8601                       | ✓ VERIFIED  | appleEpochToISO(797271288) → "2026-04-07T16:14:48.000Z" confirmed by test suite (10/10 pass)                                 |
| 5  | Database path is configurable via environment variable; server falls back to known macOS default path                | ✓ VERIFIED  | loadConfig() supports WHATSAPP_DB_PATH, WHATSAPP_DB_MODE env vars; default path verified in loader.ts                        |
| 6  | [Plan 03 truth] tsc build produces build/index.js that can be registered in Claude Desktop                           | ✗ FAILED    | build/index.js exists and runs correctly, but NOT present in claude_desktop_config.json — only imap-mcp is registered         |

**Score:** 4/5 truths verified (truth 1 is uncertain pending Claude Desktop registration; truth 6 is the root gap)

### Required Artifacts

| Artifact                            | Expected                                          | Status      | Details                                                          |
|-------------------------------------|---------------------------------------------------|-------------|------------------------------------------------------------------|
| `package.json`                      | Project deps with @modelcontextprotocol/sdk       | ✓ VERIFIED  | type:module, sdk@1.29.0, better-sqlite3@12.8.0, smol-toml@1.6.1 |
| `tsconfig.json`                     | TypeScript config with Node16                     | ✓ VERIFIED  | module:Node16, moduleResolution:Node16, outDir:./build           |
| `src/config/loader.ts`              | loadConfig, Config with TOML+env precedence       | ✓ VERIFIED  | Exports loadConfig and Config; smol-toml import; env vars work   |
| `src/utils/time.ts`                 | appleEpochToISO, APPLE_EPOCH_OFFSET_SECONDS       | ✓ VERIFIED  | Constant=978307200; function returns null for null/0; ISO output  |
| `src/db/snapshot.ts`                | createSnapshot, cleanOldSnapshots, SNAPSHOT_DIR   | ✓ VERIFIED  | .backup() call present; readonly:true; actionable TCC error       |
| `src/db/validate.ts`                | validateSchema, REQUIRED_TABLES                   | ✓ VERIFIED  | All 4 tables checked via sqlite_master; process.exit(1) on miss  |
| `src/db/connection.ts`              | openDatabase, refreshSnapshot, DatabaseHandle     | ✓ VERIFIED  | Both modes; timeout:0 for live; SQLITE_BUSY handling; no console  |
| `src/index.ts`                      | Entry point wiring config+db+server+transport     | ✓ VERIFIED  | loadConfig→openDatabase→createServer→registerTool→connect; 33 ln |
| `src/server.ts`                     | createServer factory                              | ✓ VERIFIED  | Exports createServer(); McpServer({name:whatsapp-mcp, v:1.0.0})  |
| `src/tools/refresh-snapshot.ts`     | registerRefreshSnapshotTool with readOnlyHint     | ✓ VERIFIED  | server.registerTool; readOnlyHint:true; refreshSnapshot() call    |
| `build/index.js`                    | Compiled entry point for Claude Desktop           | ✓ VERIFIED  | Exists; 25 lines substantive compiled output; server runs cleanly |

### Key Link Verification

| From                            | To                              | Via                             | Status      | Details                                                        |
|---------------------------------|---------------------------------|---------------------------------|-------------|----------------------------------------------------------------|
| `src/config/loader.ts`          | `smol-toml`                     | `import { parse } from 'smol-toml'` | ✓ WIRED | Line 1 of loader.ts confirmed                                  |
| `src/db/connection.ts`          | `src/config/loader.ts`          | `import type { Config }`        | ✓ WIRED     | Line 3 of connection.ts: `import type { Config } from "../config/loader.js"` |
| `src/db/snapshot.ts`            | `better-sqlite3`                | `.backup()` for WAL-safe copy   | ✓ WIRED     | Line 51 of snapshot.ts: `await liveDb.backup(snapshotPath)`    |
| `src/db/validate.ts`            | `better-sqlite3`                | `sqlite_master` query           | ✓ WIRED     | Line 12 of validate.ts: `"SELECT name FROM sqlite_master WHERE type='table'"` |
| `src/index.ts`                  | `src/config/loader.ts`          | `loadConfig()` call             | ✓ WIRED     | Line 2 import + line 9 call confirmed                          |
| `src/index.ts`                  | `src/db/connection.ts`          | `openDatabase()` call           | ✓ WIRED     | Line 3 import + line 12 call confirmed                         |
| `src/server.ts`                 | `@modelcontextprotocol/sdk`     | McpServer + StdioServerTransport | ✓ WIRED   | McpServer in server.ts; StdioServerTransport in index.ts       |
| `src/tools/refresh-snapshot.ts` | `src/db/connection.ts`          | `refreshSnapshot()` call        | ✓ WIRED     | Line 4-6 import + line 33 call confirmed                       |
| `build/index.js`                | `claude_desktop_config.json`    | Registration entry              | ✗ NOT_WIRED | Config only contains imap-mcp; whatsapp-mcp entry is absent    |

### Data-Flow Trace (Level 4)

Not applicable — Phase 01 does not produce components that render dynamic data. The artifacts are infrastructure modules (config loader, DB connection factory, MCP server entry point). The refresh_snapshot tool returns a static success/failure string, not queried data.

### Behavioral Spot-Checks

| Behavior                                          | Command                                   | Result                                                                                    | Status   |
|---------------------------------------------------|-------------------------------------------|-------------------------------------------------------------------------------------------|----------|
| Server starts, reads DB, enters stdio loop        | `node build/index.js` (3s, stderr capture) | Printed mode+dbpath, created snapshot, printed "Server running on stdio"                  | ✓ PASS   |
| All 10 unit tests pass                            | `node --import tsx/esm --test ...`        | 10/10 pass, 0 fail                                                                        | ✓ PASS   |
| TypeScript compiles with no errors                | `npx tsc --noEmit`                        | Exit 0, no output                                                                         | ✓ PASS   |
| No console.log in src/                            | `grep -rn "console.log" src/`             | No matches                                                                                | ✓ PASS   |
| Claude Desktop registration                       | Check claude_desktop_config.json          | Only imap-mcp present; whatsapp-mcp absent                                                | ✗ FAIL   |

### Requirements Coverage

| Requirement | Source Plan | Description                                                       | Status       | Evidence                                                        |
|-------------|-------------|-------------------------------------------------------------------|--------------|-----------------------------------------------------------------|
| INFRA-01    | 01-02       | Server validates expected tables exist at startup                 | ✓ SATISFIED  | validate.ts checks all 4 tables via sqlite_master; exits with error on miss |
| INFRA-02    | 01-02       | Snapshot mode copies DB atomically before reading (default)       | ✓ SATISFIED  | snapshot.ts uses .backup(); openDatabase defaults to snapshot mode |
| INFRA-03    | 01-02       | Live DB mode reads directly from WhatsApp DB (opt-in)             | ✓ SATISFIED  | connection.ts live branch with timeout:0 and readonly:true      |
| INFRA-04    | 01-01       | All Apple Core Data timestamps converted to ISO 8601              | ✓ SATISFIED  | time.ts appleEpochToISO with offset 978307200; 10 tests pass    |
| INFRA-05    | 01-02       | Startup permission checks with clear human-readable errors        | ✓ SATISFIED  | TCC/SQLITE_CANTOPEN error with "Grant Full Disk Access" message  |
| INFRA-06    | 01-01       | DB path configurable via env var; fallback to macOS default       | ✓ SATISFIED  | WHATSAPP_DB_PATH and WHATSAPP_DB_MODE override; default path verified |
| MCP-01      | 01-03       | Server runs over stdio transport using @modelcontextprotocol/sdk  | ✓ SATISFIED  | StdioServerTransport in index.ts; server confirmed to start      |
| MCP-02      | 01-03       | All tools annotated with readOnlyHint: true                       | ✓ SATISFIED  | refresh-snapshot.ts line 18: `annotations: { readOnlyHint: true }` |
| MCP-03      | 01-03       | No writes to stdout except MCP JSON-RPC protocol messages         | ✓ SATISFIED  | grep confirms zero console.log; all output via process.stderr.write() |

All 9 requirements are satisfied at the code level. The gap is operational (registration), not implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME, no placeholder returns, no hardcoded empty data, no console.log violations found across all source files.

### Human Verification Required

#### 1. Claude Desktop Integration

**Test:** Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`, then restart Claude Desktop (Cmd+Q, reopen):
```json
"whatsapp-mcp": {
  "command": "node",
  "args": ["/Users/jonathanhowell/code/whatsapp-mcp/build/index.js"]
}
```
**Expected:** The `refresh_snapshot` tool appears in the Claude Desktop tools panel; calling it returns "Snapshot refreshed successfully. Database now reflects the latest WhatsApp messages."
**Why human:** Cannot programmatically verify Claude Desktop's MCP tool discovery or confirm the tool is callable from the Claude UI. The server starts correctly when invoked directly — this verifies Claude Desktop's side of the integration.

### Gaps Summary

One gap blocks full goal achievement: `build/index.js` is not registered in `claude_desktop_config.json`. The SUMMARY.md claimed registration was completed during Plan 03 Task 2 (the human-verify checkpoint), but the actual config file only contains `imap-mcp`. All technical implementation is correct and substantive — the server starts, creates a snapshot from the live WhatsApp database, validates schema, routes all output to stderr, and listens on stdio. The missing step is a one-line JSON addition to the Claude Desktop config.

The gap is operational, not structural. No code changes are needed.

---

_Verified: 2026-04-07T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
