# Project Research Summary

**Project:** WhatsApp MCP Server (macOS, read-only SQLite)
**Domain:** Local MCP server — read-only access to native macOS WhatsApp Desktop database
**Researched:** 2026-04-07
**Confidence:** HIGH (schema verified by direct database inspection; stack verified from official sources; pitfalls corroborated by multiple independent sources)

## Executive Summary

This project is a local, read-only MCP server that gives Claude access to WhatsApp conversation history by querying the native macOS WhatsApp Desktop app's SQLite database directly. The native macOS app (iOS Catalyst, bundle ID `net.whatsapp.WhatsApp`) stores messages in `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite` — a Core Data SQLite database confirmed to contain 22,000+ messages, 693 chats, and 725 contacts across multiple related `.sqlite` files. This is fundamentally different from existing whatsapp-mcp implementations (lharries, felipeadeildo) that require QR code re-authentication and route messages through the unofficial WhatsApp Web API. This project reads the already-decrypted local database with no authentication and no network traffic, making it fully private and local.

The recommended approach is TypeScript with `@modelcontextprotocol/sdk` 1.29.0, `better-sqlite3` 12.8.0, and `zod` 3.25+ on Node.js 22 LTS. The architecture is straightforward: a thin MCP server layer wires Zod-validated tool handlers to a read-only SQLite connection, with a layered structure separating transport, tool routing, SQL queries, and result formatting. The server communicates via stdio (JSON-RPC) and is registered in Claude Desktop's config. The build target is a compiled `dist/index.js` produced by `tsup`. The MVP delivers four core tools — `list_chats`, `get_messages`, `get_messages_since`, and search — with all timestamps converted from Apple's Core Data epoch (2001-01-01) to ISO 8601.

The top risks are macOS-specific and must be addressed in Phase 1 before any feature work. The three most critical: (1) stdout corruption — any `console.log` on the stdio transport breaks the protocol silently; (2) WAL database access — opening the live database requires write permission on the `-shm` file, making snapshot mode the correct default; (3) macOS Sequoia TCC permissions — Node processes spawned through Claude Code's `disclaimer` wrapper may not inherit Full Disk Access grants and require explicit setup instructions. Schema fragility from WhatsApp auto-updates is a secondary ongoing risk, mitigated by startup schema validation.

## Key Findings

### Recommended Stack

The stack is minimal and well-chosen for this domain. `@modelcontextprotocol/sdk` 1.29.0 handles all MCP protocol concerns including tool registration, Zod schema validation, and stdio transport framing. `better-sqlite3` 12.8.0 is the correct SQLite library — its synchronous API eliminates async complexity with no downside for sequential read-only queries, and its `.backup()` method provides the only safe WAL-aware snapshot copy mechanism. Do not use `node:sqlite` (experimental in all current Node.js LTS versions) or raw `fs.copyFile` for snapshots. The MCP SDK v2 alpha exists but is not production-ready; use v1.29.0.

**Core technologies:**
- `@modelcontextprotocol/sdk@1.29.0`: MCP server framework — the only stable option; handles stdio transport, tool routing, schema validation
- `better-sqlite3@12.8.0`: synchronous read-only SQLite access — native `readonly: true` flag, safe `.backup()` API, no async complexity
- `zod@3.25+`: required by MCP SDK as peer dep; provides runtime validation and TypeScript inference from a single schema
- `TypeScript 5.x + Node.js 22 LTS`: type safety and runtime (Node 20 minimum required by SDK; 22 preferred for longer support)
- `tsup`: production build to single `dist/index.js`; `tsx` for development iteration without build step

### Expected Features

The schema has been directly inspected on a live system. The database structure is confirmed and well-understood. All features in the MVP have LOW implementation complexity because the schema is known and the queries are straightforward joins on well-named Core Data tables.

**Must have (table stakes — v1):**
- `list_chats` — entry point for all chat interactions; queries `ZWACHATSESSION`
- `get_messages` — core read operation with limit and date filters; queries `ZWAMESSAGE`
- `get_messages_since` — the stated primary use case (polling for new messages)
- Apple Cocoa epoch conversion — timestamps are Core Data seconds-since-2001; without this, all dates are wrong
- Configurable database path via env var — live DB and snapshot modes both needed
- Read-only connection enforcement — `readonly: true` in better-sqlite3
- `readOnlyHint: true` on all tool definitions — allows Claude Desktop auto-approval
- Media metadata alongside messages — low effort JOIN on `ZWAMEDIAITEM`, high context value

**Should have (v1.x — after core workflow validated):**
- `search_messages` — cross-chat keyword search using the existing FTS5 index (`fts/ChatSearchV5f.sqlite`) with LIKE fallback
- `get_chat` — detailed chat info including group members (`ZWAGROUPMEMBER`, `ZWAGROUPINFO`)
- `get_contact` — resolve contact names from `ContactsV2.sqlite` (`ZWAADDRESSBOOKCONTACT`)
- Snapshot copy mode — default to snapshot if live DB WAL contention is observed in practice

**Defer (v2+):**
- `get_media_file` — file retrieval with base64 encoding; useful for voice transcription but adds complexity
- Starred messages tool — `WHERE ZSTARRED = 1`, low effort but not critical for MVP
- Call history access — `CallHistory.sqlite` is available but low value for task extraction

**Anti-features (deliberately excluded):**
- Write/send messages — breaks read-only safety guarantee, risks account bans
- Real-time push/webhooks — polling via `get_messages_since` is sufficient; FSEvents adds runtime complexity
- WhatsApp Electron app support — uses LevelDB (IndexedDB), entirely different access mechanism

### Architecture Approach

The architecture is a clean layered design with clear separation of concerns: transport layer (SDK's `StdioServerTransport`) → server core (`McpServer` with tool routing and Zod validation) → tool handlers (thin orchestration, one per tool) → query layer (parameterized SQL per domain entity) → database access layer (`better-sqlite3` singleton, read-only). No external services are involved; this is a fully offline, local tool. The key structural decision is to isolate all SQL in `src/queries/` so schema changes are contained, and to pass the database connection as a dependency argument to query functions for testability.

**Major components:**
1. `Transport Layer (StdioServerTransport)` — JSON-RPC framing over stdin/stdout; owned entirely by the SDK
2. `Server Core (McpServer)` — tool registration, capability negotiation, Zod input validation
3. `Tool Handlers (src/tools/)` — one function per tool; validate args, call query layer, return formatted content
4. `Query Layer (src/queries/)` — parameterized SQL per domain entity (chats, messages, search, media); never builds SQL via string concatenation
5. `Database Access Layer (src/db/)` — single read-only `better-sqlite3` connection singleton; snapshot copy utility using `.backup()` API
6. `Config (src/config.ts)` — DB path resolution from env var with documented default; startup access validation

### Critical Pitfalls

1. **stdout corruption from console.log** — MCP stdio transport owns stdout exclusively; any `console.log` produces unparseable JSON-RPC and silently breaks all tools. Enforce ESLint `no-console` from day one; use `console.error` or the SDK's logging API only.

2. **WAL database open requires -shm write permission** — Opening a WAL-mode SQLite `readonly: true` still requires OS write permission on the `-shm` file. If this file is absent and the directory is read-only, the open throws `SQLITE_CANTOPEN`. Default to snapshot mode; use `better-sqlite3`'s `.backup()` for the copy, never `fs.copyFile`.

3. **macOS Sequoia TCC permissions block Node processes** — Claude Code spawns MCP servers via a `disclaimer` wrapper binary, and TCC permission grants do not reliably inherit. On macOS Sequoia (15.x), database reads fail with `EPERM` even after granting Full Disk Access to node. Setup docs must instruct users to grant Full Disk Access to Claude.app at the app level. Add a startup `fs.accessSync` check with a clear error message.

4. **WhatsApp schema changes silently break queries** — WhatsApp auto-updates through the App Store with no schema changelog. Run a startup `PRAGMA table_info(...)` validation against expected tables and columns; emit a structured `isError: true` response on mismatch rather than silently returning empty results.

5. **Apple Cocoa epoch misinterpretation** — `ZMESSAGEDATE` is seconds since 2001-01-01, not Unix epoch. Treating it as Unix timestamp places all messages in the early 2000s. Apply the 978307200-second offset consistently in all date queries; accept ISO 8601 input from tool parameters and convert at the query boundary.

## Implications for Roadmap

Based on the combined research, a three-phase structure is recommended. Dependencies are well-understood: database access must be verified before query code is written; query correctness must be established before MCP tool wiring; and media file retrieval is independent and can be deferred.

### Phase 1: Foundation — Project Setup, Database Access, and Safety Infrastructure

**Rationale:** Five pitfalls are Phase 1 concerns (stdout corruption, WAL permissions, TCC, TypeScript ESM build config, schema validation). None of the feature work can succeed if these are not right. The database path and schema must also be empirically confirmed — FEATURES.md schema was verified by direct inspection, but ARCHITECTURE.md notes the container path changed once before and needs runtime validation.

**Delivers:** Working TypeScript project skeleton; confirmed database connection in read-only snapshot mode; startup validation (access check + schema probe); ESLint `no-console` enforced; `tsup` build producing `dist/index.js`; MCP server registered in Claude Desktop config and responding to ping.

**Addresses:** DB path resolution, read-only enforcement, snapshot copy via `.backup()`, TCC access check, ESM build configuration.

**Avoids:** Pitfalls 1 (stdout), 2 (WAL/shm), 4 (TCC), 6 (ESM imports), 3 (schema validation scaffold).

### Phase 2: Core Tools — list_chats, get_messages, get_messages_since

**Rationale:** These three tools represent the entire MVP use case (polling WhatsApp for actionable messages). They share the same schema domain and can be built and tested together. Epoch conversion and query limits are cross-cutting concerns implemented once here.

**Delivers:** `list_chats` tool (ZWACHATSESSION with last message preview), `get_messages` tool (ZWAMESSAGE with limit + date filter + media metadata JOIN), `get_messages_since` tool (same query with date lower-bound), Apple Cocoa epoch conversion utility, default LIMIT 50 / max LIMIT 500 enforcement on all list tools, `isError: true` error handling in all tool handlers.

**Uses:** `better-sqlite3` parameterized queries, Zod tool schemas with explicit limit constraints, `readOnlyHint: true` annotations.

**Avoids:** Pitfalls 5 (epoch), 7 (tool errors as exceptions), 8 (context window overflow), 9 (epoch), 11 (vague tool descriptions).

### Phase 3: Extended Tools — Search, Contact Lookup, Chat Detail

**Rationale:** These features expand the tool surface after the core polling workflow is validated. `search_messages` uses the FTS5 index already present in the database (`fts/ChatSearchV5f.sqlite`). `get_contact` and `get_chat` require querying `ContactsV2.sqlite` as a secondary database, a slightly more complex connection setup but still low risk.

**Delivers:** `search_messages` tool with FTS5 primary path and LIKE fallback (note: FTS index covers ~4,711 of 22,892 messages — LIKE fallback is necessary for complete results), `get_chat` tool with group member list, `get_contact` tool querying ContactsV2.sqlite.

**Implements:** Multi-database connection management (ChatStorage + ContactsV2 as separate `better-sqlite3` instances).

**Avoids:** Pitfall 11 (tool naming clarity — search vs fetch tools must be clearly differentiated).

### Phase 4: Media Tools (v1.x — Post-Validation)

**Rationale:** Media retrieval is independent of the message tools and can be deferred without blocking the core use case. It introduces file I/O complexity (base64 encoding, size limits, format handling) that should not be added until the core workflow is proven.

**Delivers:** `get_media_file` tool retrieving attachment bytes from `~/Library/Group Containers/.../Message/Media/{jid}/` paths, with path resolution from relative `ZMEDIALOCALPATH` values, file existence check before returning, and size guard.

**Avoids:** Pitfall 12 (relative media paths not resolved to absolute).

### Phase Ordering Rationale

- Phase 1 must come first because macOS permission and WAL database issues will cause silent failures in all subsequent work if not resolved upfront.
- Phases 2 and 3 are sequenced by the feature dependency graph: `get_messages` depends on `list_chats` (needs the chat's Z_PK foreign key); search and contact lookup are independent enhancements.
- Phase 4 is deferred because media file handling is the only feature with non-trivial output complexity (binary data, large payloads) and is not required to validate the primary use case.
- Snapshot mode is the correct default from Phase 1; live DB mode is an advanced option documented but not the primary path.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** macOS Sequoia TCC behavior is partially documented; the exact entitlement grant path for Claude Code's `disclaimer` binary is still evolving (GitHub issue open). May need to experiment and document empirically.
- **Phase 3:** FTS5 index coverage gap (4,711 indexed vs 22,892 total messages) needs investigation — determine why messages are missing from the index and whether the LIKE fallback strategy is sufficient or if a full re-index is needed.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Query patterns are fully documented in FEATURES.md with confirmed schema and live data counts. Well-trodden MCP tool implementation patterns apply directly.
- **Phase 4:** Media path resolution is a straightforward path join; the pattern is documented in FEATURES.md and PITFALLS.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | MCP SDK and better-sqlite3 verified from official GitHub repos and npm; versions confirmed; alternatives documented with clear rationale |
| Features | HIGH | Schema verified by direct inspection of live database on development machine; message counts, table names, and column names are first-hand confirmed |
| Architecture | HIGH (MCP patterns) / MEDIUM (DB paths) | MCP architecture patterns from official SDK docs; database container path (`group.net.whatsapp.WhatsApp.shared`) confirmed in FEATURES.md but ARCHITECTURE.md used an older path — use the FEATURES.md path |
| Pitfalls | HIGH | Critical pitfalls corroborated by official SQLite docs, Claude Code GitHub issue tracker, and macOS security researchers |

**Overall confidence:** HIGH

### Gaps to Address

- **Database path discrepancy:** ARCHITECTURE.md references `~/Library/Containers/desktop.WhatsApp/...` while FEATURES.md confirmed (via direct inspection) that the active path is `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`. Use the FEATURES.md path; discard the ARCHITECTURE.md path. Validate at runtime with a startup access check.

- **FTS index coverage:** The FTS5 index in `fts/ChatSearchV5f.sqlite` covers only 4,711 of 22,892 messages. The reason for the gap is unknown. During Phase 3, determine whether this is intentional (e.g., only recent messages), a stale index, or a schema design choice. Plan the LIKE fallback as mandatory, not optional.

- **WhatsApp version compatibility:** Schema was verified on one specific WhatsApp version. Startup schema validation (`PRAGMA table_info`) is the mitigation. Track the WhatsApp version the schema was verified against in code comments.

- **Live DB vs snapshot default:** Both STACK.md and PITFALLS.md recommend snapshot as default, but the snapshot copy mechanism — whether to use `db.backup()` (best, requires opening live DB first) or copy-all-three-files (simpler) — needs a concrete decision in Phase 1. Recommendation: use `db.backup()` from a read-only connection, as this is the WAL-safe API approach.

## Sources

### Primary (HIGH confidence)
- Direct database inspection on live WhatsApp 25.x / macOS 15.x system — schema, table names, column names, message counts
- [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — SDK API, transport patterns, tool registration
- [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — API docs, readonly flag, backup API, Node.js compatibility matrix
- [sqlite.org/wal.html](https://sqlite.org/wal.html) — WAL mode behavior, -shm requirement
- [github.com/anthropics/claude-code/issues/36832](https://github.com/anthropics/claude-code/issues/36832) — TCC disclaimer wrapper issue
- [nearform.com — Implementing MCP pitfalls](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) — stdout corruption, error handling patterns

### Secondary (MEDIUM confidence)
- [kacos2000/queries WhatsApp_Chatstorage_sqlite.sql](https://github.com/kacos2000/queries/blob/master/WhatsApp_Chatstorage_sqlite.sql) — SQL reference for ChatStorage schema
- [anipotts/imessage-mcp](https://github.com/anipotts/imessage-mcp) — readOnlyHint pattern, tool naming conventions from iMessage MCP reference implementation
- [mjtsai.com — macOS Sequoia Group Containers](https://mjtsai.com/blog/2024/09/11/group-container-names-in-sequoia/) — Sequoia TCC changes
- [group-ib.com — WhatsApp forensic artifacts](https://www.group-ib.com/blog/whatsapp-forensic-artifacts/) — macOS database path corroboration

### Tertiary (LOW confidence — needs runtime validation)
- ARCHITECTURE.md's alternate DB path (`~/Library/Containers/desktop.WhatsApp/...`) — superseded by first-hand schema inspection; do not use

---
*Research completed: 2026-04-07*
*Ready for roadmap: yes*
