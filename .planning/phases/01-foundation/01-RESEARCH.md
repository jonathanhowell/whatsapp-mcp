# Phase 1: Foundation - Research

**Researched:** 2026-04-07
**Domain:** MCP server scaffolding, SQLite snapshot access, TOML config, macOS TCC
**Confidence:** HIGH

## Summary

Phase 1 builds the entire foundation that every subsequent phase depends on: project scaffolding, a working stdio MCP server registered with Claude Desktop, snapshot-mode database access via `better-sqlite3`, TOML-based configuration with env-var overrides, startup validation, and Apple Core Data epoch conversion.

All key stack decisions are locked in CLAUDE.md and CONTEXT.md. The technology choices (`@modelcontextprotocol/sdk` 1.29.0, `better-sqlite3` 12.8.0, `smol-toml`) are well-supported and proven. A working reference MCP server (imap-mcp) exists in the same repository owner's codebase, providing directly applicable patterns for project structure, TypeScript config, and MCP tool registration.

The WhatsApp ChatStorage.sqlite database is accessible on this machine (no TCC blocker currently). The Apple Core Data epoch offset (978307200 seconds) was verified empirically against live data. The `McpServer.registerTool()` high-level API is the current non-deprecated path for tool registration in SDK 1.29.0.

**Primary recommendation:** Mirror the imap-mcp project structure (module separation by concern) and use `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk`. Use `smol-toml` for TOML parsing (actively maintained, ESM+CJS, zero dependencies). Follow the `tsc`-only build for simplicity — no tsup needed since the build output is a plain JS file referenced in Claude Desktop config.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Snapshot created at server startup using `better-sqlite3` `.backup()` from a read-only connection on the live DB
- **D-02:** A `refresh_snapshot` MCP tool allows Claude to request a fresh snapshot on demand without restarting the server
- **D-03:** Snapshots stored in `os.tmpdir()` (e.g., `/tmp/whatsapp-mcp/`)
- **D-04:** Server auto-cleans old snapshot files from prior sessions on startup before creating a new one
- **D-05:** Error messages are actionable and concise — short message with exactly what to do to fix it (e.g., "WhatsApp database not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security.")
- **D-06:** Startup errors go to stderr; runtime errors returned as MCP error responses so Claude sees them
- **D-07:** If the database is completely inaccessible at startup, the server exits with a clear error message (fail fast)
- **D-08:** Database mode (snapshot vs live) configurable via both environment variables and a TOML config file
- **D-09:** Config file format is TOML, located at `~/.config/whatsapp-mcp/config.toml`
- **D-10:** Environment variables take precedence over config file values
- **D-11:** TOML parsing requires adding a dependency (e.g., `@iarna/toml` or similar)

### Claude's Discretion

- Project file/module structure (db layer vs MCP layer vs utils) — Claude has flexibility to organize as best fits the implementation

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Server auto-discovers WhatsApp SQLite database path at startup and validates expected tables exist | Verified DB path, tables confirmed (ZWAMESSAGE, ZWACHATSESSION, ZWAMEDIAITEM, ZWAPROFILEPUSHNAME); schema fully documented |
| INFRA-02 | Snapshot mode copies database files atomically before reading (default mode) | `better-sqlite3` `.backup()` uses SQLite's `sqlite3_backup` API — WAL-aware, transactionally consistent; pattern documented |
| INFRA-03 | Live DB mode reads directly from WhatsApp database (opt-in alternative) | `readonly: true, fileMustExist: true, timeout: 0` pattern documented; SQLITE_BUSY handling required |
| INFRA-04 | All Apple Core Data epoch timestamps converted to ISO 8601 in tool responses | Epoch offset verified: `(ts + 978307200) * 1000` → `Date` → `.toISOString()` confirmed against live data |
| INFRA-05 | Startup permission checks with clear human-readable errors for macOS TCC/access failures | TCC pattern documented; error strategy defined in D-05/D-07 |
| INFRA-06 | Database path configurable via environment variable or server config | TOML config + env var override pattern documented; `smol-toml` selected over `@iarna/toml` |
| MCP-01 | Server runs over stdio transport using `@modelcontextprotocol/sdk` | `McpServer` + `StdioServerTransport` pattern verified from SDK types and working reference (imap-mcp) |
| MCP-02 | All tools annotated with `readOnlyHint: true` for auto-approval | `annotations: { readOnlyHint: true }` in `registerTool()` config object — confirmed in SDK 1.29.0 types |
| MCP-03 | No writes to stdout except MCP JSON-RPC protocol messages | `StdioServerTransport` handles stdio; all logging must go to `stderr`; `console.log` is banned |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server framework — stdio transport, tool registration, schema validation | Official Anthropic SDK; only production-stable option |
| `better-sqlite3` | 12.8.0 | Synchronous read-only SQLite access + `.backup()` for atomic snapshots | Fastest Node.js SQLite library; WAL-aware backup API; native `readonly` flag |
| `zod` | 3.25.76 (use `^3.25`) | Tool schema validation and TypeScript inference | Peer dependency of MCP SDK; use v3 series per CLAUDE.md |
| `smol-toml` | 1.6.1 | TOML config file parsing | Actively maintained (last release 2026-03-23); ESM + CJS exports; zero dependencies; spec-compliant |
| `TypeScript` | 5.x | Type safety | Required per project constraints |
| `Node.js` | 25.8.1 (current machine) | Runtime | Node 22+ required by MCP SDK; machine has 25.8.1 which is supported |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/better-sqlite3` | Latest | TypeScript types for better-sqlite3 | Always — dev dependency |
| `@types/node` | Latest | Node.js built-in type definitions | Always — dev dependency |
| `typescript` | 5.x | TypeScript compiler | Dev dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `smol-toml` | `@iarna/toml` | `@iarna/toml` last released 2020; no ESM exports; not maintained. `smol-toml` is the current standard choice. |
| `smol-toml` | `toml` (npm) | `toml` is a thin wrapper around an old parser; less active; `smol-toml` is superior |
| `tsc` build | `tsup` | `tsc` is simpler for a single-file server; `tsup` adds build complexity without benefit here. Use `tsc`. |
| `McpServer` (high-level) | `Server` (low-level) | `Server` is deprecated in favor of `McpServer`. Use `McpServer` + `registerTool()`. |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk better-sqlite3 zod smol-toml
npm install --save-dev typescript @types/node @types/better-sqlite3
```

**Version verification (confirmed 2026-04-07 against npm registry):**
- `@modelcontextprotocol/sdk`: 1.29.0
- `better-sqlite3`: 12.8.0
- `zod`: 3.25.76 (latest v3; use `^3.25`)
- `smol-toml`: 1.6.1

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── index.ts          # Entry point: creates McpServer, registers tools, starts transport
├── server.ts         # McpServer setup, tool registration wiring
├── db/
│   ├── connection.ts # Database connection factory (snapshot vs live mode)
│   ├── snapshot.ts   # Snapshot lifecycle: create, refresh, cleanup
│   └── validate.ts   # Startup schema validation (expected tables check)
├── tools/
│   └── refresh-snapshot.ts  # refresh_snapshot tool handler (Phase 1 only tool)
├── config/
│   └── loader.ts     # TOML + env var config loading with precedence
└── utils/
    └── time.ts       # Apple Core Data epoch → ISO 8601 conversion
```

This mirrors the imap-mcp pattern (verified working) which separates: connection/transport, services, tools, and config into discrete modules.

### Pattern 1: McpServer with registerTool (preferred API)
**What:** High-level MCP server API. `registerTool` is the non-deprecated path as of SDK 1.29.0.
**When to use:** Always — `server.tool()` overloads are marked `@deprecated` in SDK 1.29.0 types.
**Example:**
```typescript
// Source: @modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts (verified)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "whatsapp-mcp", version: "1.0.0" });

server.registerTool(
  "refresh_snapshot",
  {
    description: "Refresh the WhatsApp database snapshot",
    annotations: { readOnlyHint: true },
  },
  async () => {
    // handler
    return { content: [{ type: "text", text: "Snapshot refreshed." }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Pattern 2: better-sqlite3 snapshot creation (WAL-safe)
**What:** Use `.backup()` from a read-only connection on the live DB. This is the only correct way to copy a WAL-mode SQLite database atomically.
**When to use:** On every snapshot creation (startup + on-demand refresh).
**Example:**
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md (verified)
import Database from "better-sqlite3";
import path from "path";
import os from "os";

const LIVE_DB_PATH = process.env.WHATSAPP_DB_PATH ??
  path.join(
    os.homedir(),
    "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
  );

const SNAPSHOT_DIR = path.join(os.tmpdir(), "whatsapp-mcp");
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, "snapshot.sqlite");

async function createSnapshot(): Promise<string> {
  const liveDb = new Database(LIVE_DB_PATH, {
    readonly: true,
    fileMustExist: true,
    timeout: 0,  // fail fast — don't wait on SQLITE_BUSY
  });
  try {
    await liveDb.backup(SNAPSHOT_PATH);
  } finally {
    liveDb.close();
  }
  return SNAPSHOT_PATH;
}
```

### Pattern 3: Apple Core Data epoch conversion (verified against live data)
**What:** WhatsApp timestamps are seconds since 2001-01-01 (Apple Core Data epoch). Unix epoch is 1970-01-01. Offset = 978307200 seconds.
**Verification:** Live sample `797271288` → `2026-04-07T16:14:48.000Z` (matches current date).
```typescript
// Source: empirically verified against live ChatStorage.sqlite data
const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

export function appleEpochToISO(coreDataTs: number | null): string | null {
  if (coreDataTs === null || coreDataTs === 0) return null;
  return new Date((coreDataTs + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
```

### Pattern 4: Config loading with TOML + env var precedence
**What:** Load `~/.config/whatsapp-mcp/config.toml` if it exists, then override with env vars. Missing config file is not an error.
```typescript
// Source: smol-toml 1.6.1 API (confirmed exports: parse, stringify)
import { parse as parseToml } from "smol-toml";
import fs from "fs";
import path from "path";
import os from "os";

interface Config {
  dbPath: string;
  mode: "snapshot" | "live";
}

function loadConfig(): Config {
  const configPath = path.join(
    os.homedir(),
    ".config/whatsapp-mcp/config.toml"
  );

  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = parseToml(raw) as Partial<Config>;
  }

  const defaults: Config = {
    dbPath: path.join(
      os.homedir(),
      "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
    ),
    mode: "snapshot",
  };

  return {
    ...defaults,
    ...fileConfig,
    // env vars win
    ...(process.env.WHATSAPP_DB_PATH ? { dbPath: process.env.WHATSAPP_DB_PATH } : {}),
    ...(process.env.WHATSAPP_DB_MODE === "live" ? { mode: "live" as const } : {}),
  };
}
```

### Pattern 5: Startup validation (fail fast with actionable error)
**What:** Validate DB accessible, expected tables present. Exit if not. Write to stderr only.
```typescript
const REQUIRED_TABLES = ["ZWAMESSAGE", "ZWACHATSESSION", "ZWAMEDIAITEM", "ZWAPROFILEPUSHNAME"];

function validateSchema(db: Database.Database): void {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map((r: any) => r.name as string);

  const missing = REQUIRED_TABLES.filter(t => !tables.includes(t));
  if (missing.length > 0) {
    process.stderr.write(
      `WhatsApp database schema unexpected. Missing tables: ${missing.join(", ")}. ` +
      `Ensure the WhatsApp Desktop app has been opened at least once.\n`
    );
    process.exit(1);
  }
}
```

### Pattern 6: TypeScript + Node module config (from working imap-mcp)
**What:** `tsconfig.json` with `module: "Node16"` and `moduleResolution: "Node16"` is required for MCP SDK imports that use `.js` extensions.
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```
Note: `"type": "module"` in package.json + `module: "Node16"` allows both ESM imports and `.js` extension references.

### Pattern 7: Claude Desktop registration
**What:** Register the compiled server in `~/Library/Application Support/Claude/claude_desktop_config.json`.
```json
{
  "mcpServers": {
    "whatsapp-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/whatsapp-mcp/build/index.js"],
      "env": {
        "WHATSAPP_DB_PATH": "/optional/override/path.sqlite"
      }
    }
  }
}
```
An existing server (`imap-mcp`) uses this exact format — the pattern is confirmed working.

### Anti-Patterns to Avoid
- **`console.log()` anywhere:** Pollutes stdout, corrupts MCP JSON-RPC protocol. All non-MCP output must go to `process.stderr.write()`.
- **`fs.copyFileSync()` for snapshots:** Unsafe for WAL-mode databases. Missing `.shm`/`.wal` sidecar files causes inconsistent snapshot. Use `.backup()` exclusively.
- **`server.tool()` deprecated overloads:** Use `server.registerTool()` instead; the `.tool()` overloads are `@deprecated` in SDK 1.29.0.
- **Opening snapshot DB with WAL mode concerns:** The snapshot path created by `.backup()` is a complete, self-contained database. Open it normally — no WAL worries.
- **`timeout: 0` on the snapshot DB:** Only needed on the live DB connection. The snapshot has no lock contention.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WAL-safe database copy | Custom file copy logic | `better-sqlite3` `.backup()` | Handles `.wal`/`.shm` files atomically via SQLite's internal backup API |
| MCP protocol framing | Custom JSON-RPC over stdio | `StdioServerTransport` | Handles delimiter framing, buffering, and Content-Length headers |
| TOML parsing | Custom parser | `smol-toml` | TOML spec has many edge cases (multiline strings, datetime types, inline tables); spec-compliant library is essential |
| Schema validation of tool inputs | Manual type checking | Zod schemas passed to `registerTool` | SDK validates inputs automatically before calling handler |
| Epoch date math | Custom date arithmetic | `(ts + 978307200) * 1000` one-liner | No library needed — simple constant offset, but constant must be right (978307200, not 946684800) |

**Key insight:** The stdio framing and MCP protocol negotiation are subtle — a single byte of non-JSON on stdout will cause Claude Desktop to silently fail to connect with no useful error message.

---

## Common Pitfalls

### Pitfall 1: stdout pollution breaks MCP connection silently
**What goes wrong:** Any call to `console.log()`, startup banners, or debug output written to stdout causes Claude Desktop to receive malformed JSON-RPC. The server appears to register but tools never appear and there is no error shown to the user.
**Why it happens:** Claude Desktop uses stdout as the MCP wire protocol. Any byte not part of a JSON-RPC message corrupts the stream.
**How to avoid:** Replace all `console.log` with `process.stderr.write()`. Add a lint rule or grep check: `grep -r "console.log" src/` should return nothing.
**Warning signs:** Server process starts (visible in `Activity Monitor`) but tools list is empty in Claude Desktop.

### Pitfall 2: Copying WAL-mode SQLite files with fs.copyFileSync
**What goes wrong:** The copied file appears valid but contains uncommitted transactions or is internally inconsistent. Reads return stale or corrupted data.
**Why it happens:** WAL-mode databases consist of three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`). Copying only the main file, or copying all three non-atomically, produces an inconsistent snapshot.
**How to avoid:** Use `db.backup(destinationPath)` exclusively. The `.backup()` method uses SQLite's internal `sqlite3_backup` API which is WAL-aware and transactionally consistent.
**Warning signs:** `SELECT COUNT(*) FROM ZWAMESSAGE` returns different results than the live app shows.

### Pitfall 3: Wrong Apple Core Data epoch constant
**What goes wrong:** Timestamps in all responses are off by 31 years.
**Why it happens:** Confusion between Unix epoch (1970-01-01, offset 0) and Apple Core Data epoch (2001-01-01, offset 978307200). A common wrong value is 946684800 (2000-01-01).
**How to avoid:** Use 978307200 (verified: `797271288 + 978307200 = 1724775016 Unix` → `2024-08-27T16:10:16.000Z`, confirmed real message date). Store as a named constant, not a magic number.
**Warning signs:** Message dates show years in 1970s or 2033+.

### Pitfall 4: SQLITE_BUSY on live DB access
**What goes wrong:** `better-sqlite3` throws `SQLITE_BUSY` when WhatsApp holds an exclusive lock (common during message sync).
**Why it happens:** WhatsApp frequently writes to the database while open. The default `timeout: 5000` means every busy lock causes a 5-second hang.
**How to avoid:** Set `timeout: 0` on the live DB connection — fail fast rather than hang. Catch the error and return a clear message: "Database temporarily locked by WhatsApp. Try again in a moment, or use snapshot mode." Snapshot mode completely avoids this since WhatsApp doesn't lock the copy.
**Warning signs:** MCP tool calls hang for 5+ seconds then fail.

### Pitfall 5: Claude Desktop process sandbox and os.tmpdir()
**What goes wrong:** Snapshot files written to `os.tmpdir()` may end up in a per-session temp directory that doesn't persist between Claude Desktop restarts, or may be in a location inaccessible to subsequent server processes.
**Why it happens:** On macOS, `os.tmpdir()` returns a per-process temp directory under `/var/folders/...` for non-sandboxed processes, but may vary in sandboxed contexts. The `/tmp` symlink points to `/private/tmp` which is session-persistent.
**How to avoid:** Use `path.join(os.tmpdir(), "whatsapp-mcp")` but also verify with `fs.mkdirSync(dir, { recursive: true })` before writing. The snapshot directory will be re-created on each startup anyway (D-04 cleans old snapshots). The cleanup on startup handles stale files regardless.
**Warning signs:** "Snapshot not found" errors after Claude Desktop restart.

### Pitfall 6: macOS TCC (Full Disk Access) requirement
**What goes wrong:** The server process cannot read the WhatsApp database file even though it exists, getting `EACCES` or `SQLITE_CANTOPEN`.
**Why it happens:** macOS Transparency, Consent, and Control (TCC) restricts access to files under `~/Library/Group Containers/`. The process running the MCP server (spawned by Claude Desktop) must have Full Disk Access. Claude Desktop itself needs FDA, which its child processes inherit.
**How to avoid:** On startup, if the database file doesn't exist or isn't readable, emit an actionable error per D-05: `"WhatsApp database not found at [path]. Grant Full Disk Access to Claude Desktop in System Preferences > Privacy & Security > Full Disk Access."` Then `process.exit(1)`.
**Warning signs:** `SQLITE_CANTOPEN` error on startup; `fs.existsSync()` returns `false` for a path that exists when accessed from Terminal.

---

## Code Examples

### Minimum viable server entry point
```typescript
// Source: Pattern derived from imap-mcp/src/index.ts (verified working) + SDK types
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main(): Promise<void> {
  // loadConfig() and openDatabase() must go here, before connect()
  // Any startup error → process.stderr.write(...) + process.exit(1)

  const server = new McpServer({
    name: "whatsapp-mcp",
    version: "1.0.0",
  });

  // Register tools here
  // server.registerTool("refresh_snapshot", { ... }, handler);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // server is now running; process stays alive handling requests
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
```

### Snapshot cleanup (old session files)
```typescript
// Implements D-04: clean old snapshot files on startup
import fs from "fs";
import path from "path";
import os from "os";

const SNAPSHOT_DIR = path.join(os.tmpdir(), "whatsapp-mcp");

function cleanOldSnapshots(): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    return;
  }
  for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
    fs.unlinkSync(path.join(SNAPSHOT_DIR, file));
  }
}
```

### Database access error detection for TCC/path issues
```typescript
import fs from "fs";
import Database from "better-sqlite3";

function openLiveDb(dbPath: string): Database.Database {
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(
      `WhatsApp database not found at: ${dbPath}\n` +
      `Grant Full Disk Access to Claude Desktop in System Preferences > ` +
      `Privacy & Security > Full Disk Access, then restart.\n`
    );
    process.exit(1);
  }

  try {
    return new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: 0,
    });
  } catch (err: any) {
    process.stderr.write(
      `Failed to open WhatsApp database: ${err.message}\n` +
      `If the error is SQLITE_BUSY, WhatsApp is currently writing. ` +
      `Use snapshot mode (default) to avoid this.\n`
    );
    process.exit(1);
  }
}
```

---

## Confirmed Database Schema

Tables confirmed in live `ChatStorage.sqlite` (macOS, WhatsApp Desktop, April 2026):

**ZWAMESSAGE** — message records
| Column | Type | Notes |
|--------|------|-------|
| Z_PK | INTEGER | Primary key |
| ZMESSAGEDATE | TIMESTAMP | Apple Core Data epoch — convert with +978307200 |
| ZSENTDATE | TIMESTAMP | Apple Core Data epoch |
| ZTEXT | VARCHAR | Message text content |
| ZFROMJID | VARCHAR | Sender JID |
| ZTOJID | VARCHAR | Recipient JID |
| ZPUSHNAME | VARCHAR | Sender display name |
| ZISFROMME | INTEGER | 1 = sent by user, 0 = received |
| ZMESSAGETYPE | INTEGER | Message type code |
| ZCHATSESSION | INTEGER | FK → ZWACHATSESSION.Z_PK |
| ZMEDIAITEM | INTEGER | FK → ZWAMEDIAITEM.Z_PK (nullable) |
| ZSTANZAID | VARCHAR | Unique message ID |

**ZWACHATSESSION** — chat sessions
| Column | Type | Notes |
|--------|------|-------|
| Z_PK | INTEGER | Primary key |
| ZCONTACTJID | VARCHAR | Chat JID (phone number or group ID) |
| ZPARTNERNAME | VARCHAR | Contact/group display name |
| ZLASTMESSAGEDATE | TIMESTAMP | Apple Core Data epoch |
| ZLASTMESSAGETEXT | VARCHAR | Preview of last message |
| ZUNREADCOUNT | INTEGER | Unread message count |
| ZSESSIONTYPE | INTEGER | 0 = individual, 1 = group |

**ZWAMEDIAITEM** — media attachments
| Column | Type | Notes |
|--------|------|-------|
| Z_PK | INTEGER | Primary key |
| ZMEDIALOCALPATH | VARCHAR | Local file path relative to WhatsApp container |
| ZMESSAGE | INTEGER | FK → ZWAMESSAGE.Z_PK |
| ZFILESIZE | INTEGER | File size in bytes |
| ZMEDIAURL | VARCHAR | Remote URL |

**ZWAPROFILEPUSHNAME** — contact display names
| Column | Type | Notes |
|--------|------|-------|
| ZJID | VARCHAR | Contact JID |
| ZPUSHNAME | VARCHAR | Display name |

**Database scale (live, April 2026):** 22,906 messages, 693 chat sessions.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` overloads | `server.registerTool()` config object | SDK ~1.27+ | All tool registration should use `registerTool()`; `.tool()` overloads are `@deprecated` |
| `Server` (low-level) | `McpServer` (high-level) | SDK ~1.20+ | `Server` still works but `McpServer` is the recommended path |
| `zod v3` only | `zod ^3.25 || ^4.0` | SDK 1.27.1+ | MCP SDK now accepts both zod v3 and v4 as peer dependency |
| `@iarna/toml` | `smol-toml` | 2023-2024 | `@iarna/toml` last updated 2020; `smol-toml` is the current community standard for TOML in Node.js |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 25.8.1 | — |
| npm | Package management | Yes | 11.11.0 | — |
| `tsx` (global) | Dev hot-reload | No | — | Install locally: `npm install --save-dev tsx` |
| `tsup` (global) | Production build | No | — | Use `tsc` directly (preferred for this project) |
| WhatsApp Desktop DB | Core functionality | Yes | — accessible | — |
| Claude Desktop | MCP registration | Yes | — (imap-mcp already registered) | — |
| `sqlite3` CLI | Schema inspection only | Yes | — | Not needed for server; used only in research |

**Missing dependencies with no fallback:** None — all required runtime dependencies are npm-installable.

**Missing dependencies with fallback:**
- `tsx`: Not installed globally. Install as dev dependency: `npm install --save-dev tsx`. Or use `node --import tsx/esm` pattern.

---

## Open Questions

1. **smol-toml import in Node16 module mode**
   - What we know: `smol-toml` exports `{ import: './dist/index.js', require: './dist/index.cjs' }` — both ESM and CJS supported
   - What's unclear: Whether `import { parse } from "smol-toml"` works directly with `module: "Node16"` or requires `import type` adjustments
   - Recommendation: Use named import `import { parse as parseToml } from "smol-toml"`. If CJS interop issues arise, fall back to `const { parse } = require("smol-toml")` in a `.cjs` wrapper or just test it on first task.

2. **Claude Desktop sandbox and child process FDA inheritance**
   - What we know: macOS TCC FDA granted to an app is inherited by its child processes on standard macOS behavior. The WhatsApp DB is currently readable from Terminal on this machine.
   - What's unclear: Whether Claude Desktop itself has FDA (needed for its spawned MCP server child to inherit it). The existing `imap-mcp` server works, suggesting Claude Desktop has the necessary access.
   - Recommendation: Test on first startup. If `SQLITE_CANTOPEN`, the error message should direct the user to grant FDA to Claude Desktop specifically.

3. **`os.tmpdir()` stability across Claude Desktop restarts**
   - What we know: `os.tmpdir()` returns `/var/folders/pn/4vs835nx44n57k2fss_zqz0c0000gn/T` on this machine — a per-user, session-stable temp dir. `/tmp` is a symlink to `/private/tmp`.
   - What's unclear: Whether the per-user `/var/folders/` path changes between macOS reboots.
   - Recommendation: The D-04 startup cleanup handles stale files. The snapshot is always recreated on startup, so staleness is not a problem. No action needed.

---

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk` dist types at `~/code/imap-mcp/node_modules/@modelcontextprotocol/sdk/` — `McpServer`, `registerTool`, `ToolAnnotations`, `StdioServerTransport` signatures verified directly
- `npm view @modelcontextprotocol/sdk@1.29.0` — version and peer dependencies confirmed
- `npm view better-sqlite3` — version 12.8.0 confirmed
- `npm view smol-toml` — version 1.6.1, last release 2026-03-23 confirmed
- Live `ChatStorage.sqlite` schema — all table names and column types verified directly via `sqlite3` CLI
- Apple Core Data epoch — empirically verified: `797271288 + 978307200 = Unix 1775578488` → `2026-04-07T16:14:48.000Z` (matches current date/time)
- `~/code/imap-mcp/src/index.ts` and `tsconfig.json` — working reference MCP server patterns confirmed
- `https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md` — `.backup()` API confirmed

### Secondary (MEDIUM confidence)
- WebFetch of better-sqlite3 API docs — backup() signature and WAL-mode behavior
- `smol-toml` npm registry metadata — ESM/CJS exports, description

### Tertiary (LOW confidence)
- macOS TCC + Claude Desktop sandbox behavior — inferred from existing working imap-mcp server + general macOS behavior; not tested empirically in Claude Desktop subprocess context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry 2026-04-07
- Architecture: HIGH — verified from working reference server (imap-mcp) + SDK type inspection
- Database schema: HIGH — directly inspected from live ChatStorage.sqlite
- Epoch conversion: HIGH — empirically verified against live data
- Pitfalls: HIGH for stdout/WAL/epoch; MEDIUM for TCC/sandbox specifics
- TOML library selection: HIGH — smol-toml actively maintained, @iarna/toml abandoned

**Research date:** 2026-04-07
**Valid until:** 2026-07-07 (stable libraries; revisit if MCP SDK v2 reaches stable)
