# Architecture Research

**Domain:** Local read-only MCP server — SQLite database reader for native macOS app
**Researched:** 2026-04-07
**Confidence:** MEDIUM (MCP SDK patterns HIGH; WhatsApp DB path LOW — requires empirical verification)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Client Layer                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Claude Code / Claude Desktop                             │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                             │ JSON-RPC over stdio                │
└─────────────────────────────┼───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                     MCP Server Process                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Transport Layer (StdioServerTransport)                   │   │
│  │  - stdin/stdout framing, JSON-RPC serialization          │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                             │                                    │
│  ┌──────────────────────────▼────────────────────────────────┐  │
│  │  Server Core (McpServer)                                   │  │
│  │  - Capability negotiation                                  │  │
│  │  - Tool registration & routing                             │  │
│  │  - Input validation (Zod schemas)                         │  │
│  └──┬──────────┬──────────┬──────────┬────────────────────────┘  │
│     │          │          │          │                           │
│  ┌──▼──┐  ┌───▼──┐  ┌────▼─┐  ┌────▼──────┐                    │
│  │list │  │fetch │  │search│  │media      │  ← Tool Handlers   │
│  │chats│  │msgs  │  │      │  │retrieval  │                    │
│  └──┬──┘  └───┬──┘  └────┬─┘  └────┬──────┘                    │
│     │          │          │          │                           │
│  ┌──▼──────────▼──────────▼──────────▼──────────────────────┐   │
│  │  Query Layer                                               │   │
│  │  - Parameterized SQL builders                             │   │
│  │  - Result formatters (rows → MCP content)                 │   │
│  └───────────────────────────┬────────────────────────────────┘  │
│                               │                                   │
│  ┌────────────────────────────▼──────────────────────────────┐   │
│  │  Database Access Layer                                     │   │
│  │  - Connection manager (better-sqlite3, read-only mode)    │   │
│  │  - Snapshot copy support (cp + open copy)                 │   │
│  │  - Config: live DB path vs snapshot path                  │   │
│  └────────────────────────────┬──────────────────────────────┘   │
└────────────────────────────────┼────────────────────────────────-┘
                                 │ read-only file access
┌────────────────────────────────▼────────────────────────────────┐
│  macOS File System                                               │
│                                                                  │
│  Live DB:                                                        │
│  ~/Library/Containers/desktop.WhatsApp/Data/Library/            │
│    Application Support/WhatsApp/ChatStorage.sqlite              │
│                                                                  │
│  Snapshot (user-defined or default temp path):                  │
│  e.g. /tmp/whatsapp-snapshot.sqlite                             │
│                                                                  │
│  Media:                                                          │
│  ~/Library/Containers/WhatsApp/Data/Library/                    │
│    Application Support/WhatsApp/Media/                          │
└─────────────────────────────────────────────────────────────────┘
```

**Confidence note on DB path:** The container identifier `desktop.WhatsApp` and filename `ChatStorage.sqlite` are corroborated by multiple forensics sources (GROUP-IB, Belkasoft) but should be verified empirically in Phase 1 before any code is written. The native macOS app has changed container names across versions.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Transport Layer | Framing JSON-RPC messages over stdin/stdout | `StdioServerTransport` from `@modelcontextprotocol/sdk` |
| Server Core | Tool registration, capability negotiation, routing, Zod schema validation | `McpServer` from `@modelcontextprotocol/sdk` |
| Tool Handlers | One function per MCP tool — validates args, calls query layer, returns content | Plain async functions, one file per tool group |
| Query Layer | Builds parameterized SQL, executes via DB layer, formats rows → MCP content | Dedicated query modules, one per domain entity (chat, message, media) |
| Database Access Layer | Opens connection in read-only mode, manages single connection lifetime, handles snapshot path | `better-sqlite3` with `readonly: true` flag |
| Config | Resolves DB path (live vs snapshot), surfaces as typed config object | Environment variables + defaults, read at startup |

## Recommended Project Structure

```
src/
├── index.ts                  # Entry point: create server, register tools, connect transport
├── server.ts                 # McpServer instance creation and tool wiring
├── config.ts                 # DB path resolution, env vars, defaults
├── db/
│   ├── connection.ts         # Open/close better-sqlite3 connection (singleton, read-only)
│   └── snapshot.ts           # Copy live DB to temp path for snapshot mode
├── queries/
│   ├── chats.ts              # SQL for listing chats (ZWACHATSESSION)
│   ├── messages.ts           # SQL for fetching/filtering messages (ZWAMESSAGE)
│   ├── search.ts             # Full-text search query (FTS or LIKE)
│   └── media.ts              # Media metadata queries (ZWAMEDIAITEM)
├── tools/
│   ├── listChats.ts          # Tool handler: list_chats
│   ├── fetchMessages.ts      # Tool handler: fetch_messages
│   ├── searchMessages.ts     # Tool handler: search_messages
│   └── getMedia.ts           # Tool handler: get_media
└── formatters/
    ├── chatFormatter.ts      # Row[] → MCP TextContent for chat lists
    └── messageFormatter.ts   # Row[] → MCP TextContent for message threads
```

### Structure Rationale

- **db/:** Isolates all connection concerns; keeps tool handlers free of driver details. Single connection object is passed down as a dependency.
- **queries/:** SQL stays in one place — easy to test, easy to replace if WhatsApp changes its schema.
- **tools/:** Each tool is a thin orchestration layer — validate args, call query, call formatter. No SQL here.
- **formatters/:** Separates "what to fetch" from "how to present it". Makes it easy to change output shape without touching queries.
- **config.ts at root:** Startup concerns (path resolution) are visible without diving into subdirectories.

## Architectural Patterns

### Pattern 1: Single Read-Only Connection (Singleton)

**What:** Open one `better-sqlite3` connection at server startup, reuse it for all tool calls, close on exit.
**When to use:** Always — this is a single-process local server with no concurrency pressure. SQLite is safe for multiple sequential reads on one connection.
**Trade-offs:** Simple and correct. No overhead of pool management. Connection failure fails fast at startup.

**Example:**
```typescript
// db/connection.ts
import Database from 'better-sqlite3';
import { resolveDbPath } from '../config.js';

let db: Database.Database | null = null;

export function getConnection(): Database.Database {
  if (!db) {
    db = new Database(resolveDbPath(), { readonly: true, fileMustExist: true });
  }
  return db;
}

export function closeConnection(): void {
  db?.close();
  db = null;
}
```

### Pattern 2: Parameterized Query Functions

**What:** Each query module exports typed functions that accept domain parameters and return typed rows. SQL lives in the function body, never built via string concatenation.
**When to use:** Always — prevents SQL injection even with a read-only DB, and makes queries testable in isolation.
**Trade-offs:** More verbose than inline SQL in handlers, but critical for correctness and maintainability.

**Example:**
```typescript
// queries/messages.ts
import type Database from 'better-sqlite3';

export interface MessageRow {
  Z_PK: number;
  ZTEXT: string | null;
  ZMESSAGEDATE: number;
  ZISFROMME: number;
  ZFROMJID: string | null;
}

export function fetchMessages(
  db: Database.Database,
  chatId: number,
  limit: number,
  since?: number
): MessageRow[] {
  const sql = since
    ? `SELECT Z_PK, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZFROMJID
       FROM ZWAMESSAGE WHERE ZCHATSESSION = ? AND ZMESSAGEDATE > ?
       ORDER BY ZMESSAGEDATE DESC LIMIT ?`
    : `SELECT Z_PK, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZFROMJID
       FROM ZWAMESSAGE WHERE ZCHATSESSION = ?
       ORDER BY ZMESSAGEDATE DESC LIMIT ?`;

  return since
    ? db.prepare(sql).all(chatId, since, limit) as MessageRow[]
    : db.prepare(sql).all(chatId, limit) as MessageRow[];
}
```

### Pattern 3: Snapshot Copy Before Read

**What:** When configured for snapshot mode, copy the live `.sqlite` file (and its WAL file if present) to a temp location before opening, then read from the copy.
**When to use:** Default mode — the WhatsApp Desktop app may hold an exclusive lock or be mid-write when the MCP server runs. Snapshots avoid read errors and eliminate any risk of corrupting the live database.
**Trade-offs:** Data is slightly stale (snapshot age), but for a personal assistant workflow this is acceptable. Adds ~50-500ms at startup depending on DB size.

**Example:**
```typescript
// db/snapshot.ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function createSnapshot(sourcePath: string): string {
  const dest = path.join(os.tmpdir(), `whatsapp-snapshot-${Date.now()}.sqlite`);
  fs.copyFileSync(sourcePath, dest);
  // Copy WAL file if present (required for consistent snapshot)
  const walPath = sourcePath + '-wal';
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, dest + '-wal');
  }
  return dest;
}
```

## Data Flow

### Request Flow (Tool Invocation)

```
Claude Code sends tool call
    │
    ▼ (JSON-RPC over stdin)
StdioServerTransport.receive()
    │
    ▼
McpServer.route(toolName, rawArgs)
    │
    ▼ (Zod validation)
Tool Handler (e.g. fetchMessages)
    │ calls with typed args
    ▼
Query Function (queries/messages.ts)
    │ executes prepared statement
    ▼
better-sqlite3 → ChatStorage.sqlite (read-only)
    │ returns Row[]
    ▼
Formatter (formatters/messageFormatter.ts)
    │ returns MCP TextContent[]
    ▼
Tool Handler returns { content: [...] }
    │
    ▼ (JSON-RPC over stdout)
Claude Code receives result
```

### Startup Flow

```
process starts (spawned by Claude Code / claude_desktop_config.json)
    │
    ▼
config.ts resolves DB path
    │ (env var WHATSAPP_DB_PATH, or default container path)
    ▼
If snapshot mode: db/snapshot.ts copies live DB to /tmp/
    │
    ▼
db/connection.ts opens better-sqlite3 in readonly mode
    │ (fails fast if file not found)
    ▼
server.ts registers all tools on McpServer instance
    │
    ▼
index.ts connects McpServer to StdioServerTransport
    │
    ▼
Server ready — waits for tool calls on stdin
```

### Key Data Flows

1. **Chat listing:** `ZWACHATSESSION` rows → contact/group name + last message time → formatted text list
2. **Message fetch:** `ZWAMESSAGE JOIN ZWACHATSESSION` rows, filtered by chat ID and optional date/limit → chronological message thread
3. **Search:** `ZWAMESSAGE WHERE ZTEXT LIKE ?` (or FTS5 virtual table if present) → matching messages with chat context
4. **Media metadata:** `ZWAMEDIAITEM JOIN ZWAMESSAGE` → media type, filename, local path
5. **Media retrieval:** Read file bytes from `~/Library/Containers/.../Media/` path stored in `ZMEDIALOCALPATH` column → return as base64 content

## Scaling Considerations

This is a local single-user tool — scaling is not a concern. The relevant operational concerns are:

| Concern | Approach |
|---------|----------|
| Large message history (millions of rows) | Use `LIMIT` and date filters on all queries; never full-table scan |
| WhatsApp DB locked by running app | Snapshot mode (default); avoid opening live DB while app is active |
| Schema changes after WhatsApp update | Keep SQL in query layer; fail fast with clear error when expected table/column absent |
| Slow startup | Open connection lazily on first tool call rather than at server start, if startup latency matters |

## Anti-Patterns

### Anti-Pattern 1: Logging to stdout

**What people do:** Use `console.log()` for debugging output.
**Why it's wrong:** stdout is exclusively owned by the MCP stdio transport. Any non-JSON-RPC bytes on stdout will corrupt the protocol and cause the client to disconnect.
**Do this instead:** Use `console.error()` for all diagnostics, or the MCP SDK's server-side logging API (`server.sendLoggingMessage()`).

### Anti-Pattern 2: Opening the Live DB Directly (Default Mode)

**What people do:** Open `ChatStorage.sqlite` directly from the WhatsApp container as the default behavior.
**Why it's wrong:** SQLite's WAL mode means the database may be in a partially-written state. If WhatsApp has an exclusive write lock, `better-sqlite3` will throw `SQLITE_BUSY`. Worse, opening with a stale WAL can return inconsistent data.
**Do this instead:** Default to snapshot mode. Copy both the `.sqlite` and `.sqlite-wal` files to `/tmp/` before opening.

### Anti-Pattern 3: Building SQL via String Concatenation

**What people do:** Construct queries like `` `SELECT * FROM ZWAMESSAGE WHERE ZTEXT LIKE '%${keyword}%'` ``
**Why it's wrong:** Even though this is a read-only database, malformed strings can cause query errors or return unexpected results. Parameterized statements are the only safe and correct approach.
**Do this instead:** Use `db.prepare(sql).all(params)` with `?` placeholders for all variable inputs.

### Anti-Pattern 4: Hardcoding the DB Path

**What people do:** Embed `~/Library/Containers/desktop.WhatsApp/...` as a constant.
**Why it's wrong:** WhatsApp's container identifier has changed across app versions (older versions used `net.whatsapp.WhatsApp`). A hardcoded path breaks silently when the app updates.
**Do this instead:** Resolve the path at startup from an env var with a documented default. Surface a clear error message when the path doesn't exist. Let users override via config.

### Anti-Pattern 5: Fetching Media as Part of Message Listing

**What people do:** Include media file bytes in every `fetch_messages` response.
**Why it's wrong:** Media files can be megabytes each. Embedding them in message tool output makes responses too large for the model context and slows every call.
**Do this instead:** Message tools return media metadata only (type, filename, local path). A separate `get_media` tool fetches a specific file on demand.

## Integration Points

### External Services

None — this is a fully local, offline tool. No network calls.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Tool Handler → Query Layer | Direct TypeScript function call | Query functions accept `db` as first arg (dependency injection) |
| Query Layer → DB Access Layer | Via `getConnection()` singleton | Handler passes the connection; query functions do not call `getConnection()` themselves — keeps them testable |
| Config → DB Access | Config resolves path; `getConnection()` reads resolved path | Startup order: config first, then snapshot (if needed), then connection |
| Server → Transport | MCP SDK manages this internally | Developer does not handle serialization directly |

## Suggested Build Order

Dependencies determine the order:

1. **Config + DB path discovery** — Everything else depends on knowing where the database is. Must verify empirically before writing query code. This is Phase 1 work.
2. **DB access layer + snapshot utility** — Foundation for all queries. Build and test with a real snapshot before writing any tool logic.
3. **Query layer (one table at a time)** — Start with `listChats` (simpler schema), then `fetchMessages`, then `search`, then `media`. Each can be tested independently with a SQLite CLI.
4. **Formatters** — Build alongside queries; they are thin wrappers over row data.
5. **Tool handlers + MCP server wiring** — Wire queries into MCP tools once queries are verified correct. Tool handlers should be thin.
6. **End-to-end integration** — Connect to Claude Code, test the full stdio loop.

## Sources

- [MCP TypeScript SDK — server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — HIGH confidence, official docs
- [MCP TypeScript SDK — npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — HIGH confidence, official
- [MCP Developer Guide 2026](https://particula.tech/blog/mcp-developer-guide) — MEDIUM confidence
- [MCP TypeScript Complete Guide](https://mcpize.com/blog/mcp-server-typescript) — MEDIUM confidence
- [MCP TypeScript SDK Complete Guide — Agentailor](https://blog.agentailor.com/posts/mcp-typescript-sdk-complete-guide) — MEDIUM confidence
- [WhatsApp forensic artifacts — GROUP-IB](https://www.group-ib.com/blog/whatsapp-forensic-artifacts/) — LOW confidence for macOS Desktop paths (source focuses on mobile/iOS)
- [WhatsApp forensics on computers — Belkasoft](https://belkasoft.com/whatsapp_forensics_on_computers) — LOW confidence (desktop path `~/Library/Containers/desktop.WhatsApp` mentioned, not schema detail)
- [WhatsApp ChatStorage SQL — kacos2000/Queries](https://github.com/kacos2000/queries/blob/master/WhatsApp_Chatstorage_sqlite.sql) — MEDIUM confidence for schema (iOS origin; macOS Desktop schema is likely identical given shared codebase, but unverified)
- [WhatsApp Desktop media path — MakeTechEasier](https://www.maketecheasier.com/whatsapp-desktop-files-location/) — LOW confidence (media path only)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — HIGH confidence, official repo
- [sqlite-explorer MCP server (reference implementation)](https://github.com/hannesrudolph/sqlite-explorer-fastmcp-mcp-server) — MEDIUM confidence (Python, but pattern applicable)

---
*Architecture research for: WhatsApp MCP Server (read-only SQLite, macOS)*
*Researched: 2026-04-07*
