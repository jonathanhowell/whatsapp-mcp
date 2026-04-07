# Domain Pitfalls

**Domain:** WhatsApp MCP server — read-only access to WhatsApp Desktop macOS SQLite database
**Researched:** 2026-04-07

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or the server silently returning wrong data.

---

### Pitfall 1: Writing console.log() to stdout in a stdio MCP server

**What goes wrong:** The MCP stdio transport uses stdout as a JSON-RPC message channel. Any text written to stdout — including `console.log()`, process startup messages, or debug output — corrupts the protocol stream. The client receives malformed JSON and either drops the connection or misparses tool responses. The server appears to run but tools silently fail.

**Why it happens:** Developers habitually reach for `console.log()` for diagnostics. Node.js's `console.log` writes to stdout by default. There is no runtime warning; the damage is invisible until the client breaks.

**Consequences:** Complete server failure. Client cannot parse responses. All tools unavailable.

**Prevention:**
- Ban `console.log` from the codebase with an ESLint rule (`no-console` with only `console.error`/`console.warn` allowed).
- Use a logging library (e.g., `pino`) configured to write exclusively to stderr.
- Write a startup check: emit a single `console.error("server started")` to confirm stderr works, never stdout.

**Detection:** Transport-level parse errors in the MCP client log. Server starts but tools return no response.

**Phase:** Phase 1 (MCP server scaffold). Must be enforced before any other code is written.

---

### Pitfall 2: Opening the live WhatsApp WAL database requires write permission on the -shm file

**What goes wrong:** WhatsApp Desktop's `ChatStorage.sqlite` runs in WAL (Write-Ahead Logging) mode. Opening a WAL database for read requires write access to the companion `-shm` (shared memory) file, even for a purely read-only connection. If the `-shm` file does not exist and your process lacks write permission to the directory, SQLite returns `SQLITE_CANTOPEN` or `SQLITE_READONLY`. On macOS, the database lives in `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`, which your process can generally write to (see Pitfall 4) — but this is a fragile assumption.

**Why it happens:** SQLite WAL mode requires the `-shm` file for coordinating concurrent readers, even when no writes occur. The `readonly` flag in better-sqlite3 does not relax this OS-level requirement; it only prevents your connection from issuing write statements.

**Consequences:** The server crashes at startup or on every query attempt with `SQLITE_CANTOPEN`. Live-DB mode is effectively broken.

**Prevention:**
- Use the `immutable` URI query parameter (`file:ChatStorage.sqlite?immutable=1`) when you want a true snapshot-style open that does not need -shm/-wal. Accept that this connection will not see live writes.
- For live-DB reads, open `readonly: false` but issue no write statements. This is the safest path to ensure -shm can be created.
- Prefer the snapshot copy workflow: copy the database file (including -wal and -shm) before opening; then open the copy normally. This sidesteps all WAL coordination complexity.
- Wrap database open in a try/catch and emit a useful error message explaining the -shm requirement.

**Detection:** `SqliteError: unable to open database file` or `SQLITE_CANTOPEN` on server startup.

**Phase:** Phase 1 (database layer). Affects the fundamental read strategy.

---

### Pitfall 3: WhatsApp Desktop silently changes schema between app updates

**What goes wrong:** WhatsApp auto-updates through the App Store. Schema changes — renamed columns, new NOT NULL constraints, dropped tables, added join tables — arrive without a migration changelog visible to third-party readers. Queries that worked on v25.x break on v26.x with no warning. The failure mode is often silent: a LEFT JOIN that previously returned rows returns NULL for the new column; an INNER JOIN silently drops records that now lack the new foreign key.

**Why it happens:** Meta owns the schema and has no obligation to version it for external readers. The macOS Catalyst port (which brought the `Group Containers` layout) already changed the database path once (from `Library/Application Support/WhatsApp/` to `Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`). Another such migration is plausible.

**Consequences:** Chat list returns empty. Messages return with missing fields (null sender, null timestamp). Search returns no results. The server appears healthy but data is wrong.

**Prevention:**
- On startup, run a schema validation query: check that expected tables (`ZWAMESSAGE`, `ZWACHATSESSION`, `ZWAPROFILEPUSHNAME`, `ZWAMEDIAITEM`) and their key columns exist using `PRAGMA table_info(...)`.
- Emit a structured error if validation fails: `{ isError: true, content: "Schema mismatch: ZWAMESSAGE.ZTEXT column not found. WhatsApp may have updated. Re-run schema discovery." }`.
- Keep a `SCHEMA_VERSION` constant in code tied to the WhatsApp version it was verified against.
- Use `LEFT JOIN` instead of `INNER JOIN` for optional relations (media, push names) so missing data degrades gracefully rather than silently dropping rows.

**Detection:** Empty result sets when WhatsApp clearly has messages. Schema validation errors on startup. `no such column` SQL errors at runtime.

**Phase:** Phase 1 (database layer) and Phase 2 (query implementation). Schema validation belongs in Phase 1.

---

### Pitfall 4: macOS Sequoia tightened Group Containers access — permission prompts or silent denial

**What goes wrong:** macOS Sequoia (15.x) extended SIP-like protections to Group Containers. Processes not identified as members of `group.net.whatsapp.WhatsApp.shared` can be blocked or shown a recurring "would like to access data from other apps" TCC prompt. For Node.js processes spawned by Claude Code via the `disclaimer` helper binary, TCC permission grants do not persist reliably (see also Pitfall 5). If the user denies or dismisses the prompt, file reads fail silently or throw `EPERM`.

**Why it happens:** Apple tightened Group Container access in Sequoia as a privacy control. Third-party security researchers confirmed WhatsApp's container was accessible before Sequoia; post-Sequoia behavior is stricter. Node processes spawned transitively through the `disclaimer` wrapper accumulate separate TCC entries that don't inherit from Claude.app's entitlements.

**Consequences:** Database reads fail with `EACCES` or `EPERM`. The server starts but all tools return errors. The user may not see the TCC prompt if it was suppressed.

**Prevention:**
- Document in setup instructions: the user must grant Full Disk Access to both Claude.app and the Node.js binary in System Settings > Privacy & Security > Full Disk Access.
- At startup, attempt to `fs.accessSync` the database path and emit a clear error if it fails: `Cannot read WhatsApp database at [path]. Check Full Disk Access permissions in System Settings.`
- Test on macOS Sequoia (15.x) explicitly, not just Ventura or Sonoma.
- Provide a `--test-access` CLI flag that validates file access and reports the exact path being checked.

**Detection:** `EACCES` or `EPERM` errors on file open. Works in one terminal session, fails when spawned by Claude Code.

**Phase:** Phase 1 (setup and access layer). Must be addressed before any database code is written.

---

### Pitfall 5: Recurring TCC permission prompts when Claude Code spawns MCP servers via the disclaimer binary

**What goes wrong:** Claude Code spawns MCP server processes through `/Applications/Claude.app/Contents/Helpers/disclaimer /path/to/node <server>`. macOS TCC ties permission grants to the requesting process, not the ultimate executable. Because `disclaimer` is the intermediary, granting Automation or Full Disk Access to `node` doesn't satisfy TCC requests initiated through `disclaimer`. The permission prompt fires on every launch and sometimes mid-session (on first tool call).

**Why it happens:** This is a known Claude Code issue (GitHub #36832, duplicate of #36675). The `disclaimer` wrapper creates a process hierarchy where TCC cannot persist grants normally.

**Consequences:** The user must repeatedly click "Allow" to use the MCP server. On macOS Sequoia, the prompt can appear mid-conversation. If the user clicks "Don't Allow" once, the server loses database access for the session.

**Prevention:**
- In setup docs, instruct the user to grant Full Disk Access to Claude.app at the app level (not the node binary level), as this is the highest-level grant and most likely to survive the wrapper.
- Validate access at startup and provide a clear error rather than hanging silently waiting for a TCC prompt the user may not see.
- Monitor the Claude Code issue tracker; this may be fixed in a future Claude Code release.

**Detection:** "node would like to access data from other apps" prompt on every session. Server works interactively but fails when started programmatically.

**Phase:** Phase 1 (setup). Document in the server's README/setup instructions.

---

## Moderate Pitfalls

---

### Pitfall 6: TypeScript compilation of ESM MCP SDK fails at runtime with import errors

**What goes wrong:** The official `@modelcontextprotocol/sdk` uses ECMAScript Modules. A standard `tsc` compilation without proper `moduleResolution` and `.js` extension handling produces code that fails at runtime with `ERR_MODULE_NOT_FOUND` or `Cannot find module` errors. The TypeScript compiles cleanly but Node.js cannot resolve imports.

**Prevention:**
- Use a bundler (`tsdown`, `esbuild`, or `tsx` for development) rather than bare `tsc` for the final build.
- If using `tsc` directly, configure `"moduleResolution": "bundler"` or `"node16"` in `tsconfig.json` and add `.js` extensions to all relative imports in source.
- Use `tsx` for development (`npx tsx src/index.ts`) which handles ESM transparently.

**Detection:** Server fails to start with module resolution errors despite successful TypeScript compilation.

**Phase:** Phase 1 (project setup).

---

### Pitfall 7: Tool errors thrown as exceptions instead of returned as isError responses

**What goes wrong:** If a tool handler throws an uncaught exception (e.g., `SQLITE_BUSY`, schema validation failure, missing media file), the MCP SDK converts it to a protocol-level error. Protocol-level errors are not visible to the LLM — Claude sees a generic failure and cannot self-correct. The LLM cannot retry with different parameters, suggest the user fix permissions, or degrade gracefully.

**Why it happens:** Node.js async/await encourages letting exceptions propagate. MCP's error model has two distinct layers: tool-level errors (LLM-visible via `isError: true`) and protocol-level errors (LLM-invisible).

**Prevention:**
- Wrap every tool handler in a top-level try/catch.
- Return `{ isError: true, content: [{ type: "text", text: "Specific error message" }] }` for all operational failures (database locked, file not found, schema mismatch).
- Reserve thrown exceptions only for truly unrecoverable programmer errors.
- Test that database-locked and permission-denied errors produce LLM-visible error messages, not protocol failures.

**Detection:** Claude reports "tool failed" without details. Logs show uncaught exceptions in the server process.

**Phase:** Phase 1 (MCP scaffolding). Phase 2 (individual tool handlers).

---

### Pitfall 8: Returning too many messages hits context window limits

**What goes wrong:** A request for "all messages from this chat" on an active chat returns thousands of rows. The JSON serialization of 1,000 messages with metadata easily exceeds 25,000 tokens. The MCP client truncates or rejects the response, and Claude receives partial data without knowing it is partial.

**Why it happens:** SQLite has no built-in result size awareness. Without a LIMIT, queries return everything.

**Prevention:**
- Enforce hard limits in every query: default `LIMIT 50`, configurable up to `LIMIT 500` via tool parameter.
- Include `total_count` in responses so Claude knows how many records exist vs. how many were returned.
- Require a `limit` parameter in the tool schema with an explicit max constraint (Zod: `.int().min(1).max(500).default(50)`).
- For search results, return message snippets (first 200 chars) rather than full text, with a separate fetch-by-ID tool for full content.

**Detection:** Tool responses that are unusually slow. Context window errors in Claude Code. Claude referencing only the first N messages despite requesting more.

**Phase:** Phase 2 (tool schema design). Every tool that returns message lists must have this constraint.

---

### Pitfall 9: WhatsApp's custom epoch (2001-01-01) misinterpreted as Unix epoch

**What goes wrong:** `ZWAMESSAGE.ZMESSAGEDATE` stores timestamps as seconds since 2001-01-01 (Core Data epoch), not the Unix epoch (1970-01-01). Naively treating the value as a Unix timestamp produces dates ~31 years in the past. Filtering by date range with Unix epoch assumptions returns wrong or empty results.

**Prevention:**
- Use the SQLite conversion: `datetime('2001-01-01', ZMESSAGEDATE || ' seconds')` in all date queries.
- Document this epoch offset prominently in the query layer code.
- Add a test: assert that a known recent message has a `ZMESSAGEDATE` value consistent with the Core Data epoch, not Unix epoch.
- When accepting date parameters from MCP tool calls, accept ISO 8601 strings and convert to Core Data seconds before querying.

**Detection:** All message timestamps appear to be from the early 2000s or 1970s. Date range filters return no results or wrong results.

**Phase:** Phase 2 (query implementation). Affects every query with date filtering.

---

### Pitfall 10: Snapshot copy of a WAL database without copying -wal and -shm files is corrupted

**What goes wrong:** Copying only `ChatStorage.sqlite` without `ChatStorage.sqlite-wal` and `ChatStorage.sqlite-shm` produces a corrupt or stale snapshot. The WAL file contains committed transactions that have not yet been checkpointed into the main file. A database opened without its WAL file is missing those transactions and appears to have an older, potentially inconsistent state.

**Prevention:**
- Always copy all three files atomically: `ChatStorage.sqlite`, `ChatStorage.sqlite-wal`, `ChatStorage.sqlite-shm`.
- Better: use SQLite's `VACUUM INTO 'snapshot.sqlite'` command which produces a single clean file with all WAL data incorporated. This is the safest snapshot mechanism.
- Alternatively, use better-sqlite3's `db.backup('snapshot.sqlite')` which uses SQLite's online backup API and is WAL-safe.
- Never rely on filesystem copy (`fs.copyFile`) of a live WAL database — the window between copying the main file and the WAL file allows inconsistency.

**Detection:** Snapshot opens without error but messages are missing or data appears stale. `PRAGMA integrity_check` returns errors.

**Phase:** Phase 2 (snapshot copy implementation).

---

## Minor Pitfalls

---

### Pitfall 11: Tool names and descriptions are vague, causing LLM to call the wrong tool

**What goes wrong:** With multiple tools (list chats, fetch messages, search, fetch since timestamp, fetch media), vague names like `get_messages` vs `search_messages` cause Claude to pick the wrong tool. The LLM calls a full-fetch tool when a search was needed, returns thousands of rows, and hits token limits.

**Prevention:**
- Name tools with verb + object + qualifier: `list_chats`, `get_messages_from_chat`, `search_messages_by_keyword`, `get_messages_since_timestamp`, `get_media_file`.
- Write descriptions that explicitly state when NOT to use the tool: "Use search_messages_by_keyword to find specific content. Use get_messages_from_chat only when you need chronological history from a known chat."
- Test tool selection with MCP Inspector before integration testing with Claude.

**Phase:** Phase 2 (tool API design). Review descriptions before shipping.

---

### Pitfall 12: Media file paths in the database are relative, not absolute

**What goes wrong:** `ZWAMEDIAITEM.ZMEDIALOCALPATH` stores a relative path within the WhatsApp data directory. Returning this path directly to Claude produces a path that does not exist if the tool does not resolve it against the correct base directory. The base directory varies by macOS version and install type.

**Prevention:**
- Resolve media paths against the database's parent directory at query time.
- Confirm the base path is `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media/`.
- Verify path existence before returning; return `null` with a note if the file is absent (common for old media that was auto-deleted).

**Phase:** Phase 3 (media tool).

---

### Pitfall 13: structuredContent omission when outputSchema is defined

**What goes wrong:** If a tool declares an `outputSchema` in the MCP SDK but the handler returns only `content` (text) without a `structuredContent` field, the SDK throws a validation error at the protocol level — even for error responses that set `isError: true`.

**Prevention:**
- Always return `structuredContent` if `outputSchema` is declared, including in catch blocks.
- Consider not using `outputSchema` for tools where error responses are common; use structured JSON in the text `content` field instead, which Claude can parse equally well.

**Phase:** Phase 2 (tool implementation).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: MCP scaffold | stdout corruption via console.log | ESLint no-console rule, stderr-only logging from day one |
| Phase 1: Database access | macOS TCC/permissions EPERM | Startup access check with clear error message |
| Phase 1: Database open | WAL -shm write requirement | Use immutable flag for snapshots, test live-DB open explicitly |
| Phase 1: TypeScript build | ESM import resolution failure | Use tsdown or tsx, not bare tsc |
| Phase 2: Query layer | Custom epoch misinterpretation | Epoch conversion utility, tested against known message |
| Phase 2: Query layer | Schema change breaks queries | Startup schema validation against expected columns |
| Phase 2: Tool design | Token limit overflow | Hard LIMIT on all list/search queries, default 50, max 500 |
| Phase 2: Error handling | Exceptions hidden from LLM | Try/catch all handlers, return isError: true |
| Phase 2: Snapshot copy | Incomplete WAL copy | Use db.backup() API, never raw fs.copyFile on live DB |
| Phase 3: Media tool | Relative paths not resolved | Resolve against known base dir, check existence before return |

---

## Sources

- [Implementing MCP: Tips, Tricks and Pitfalls — Nearform](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) (HIGH confidence — verified implementation guide)
- [Building MCP Servers the Right Way — Mauro Canuto (Medium)](https://maurocanuto.medium.com/building-mcp-servers-the-right-way-a-production-ready-guide-in-typescript-8ceb9eae9c7f) (HIGH confidence — production guide with code)
- [MCP TypeScript SDK server.md — Official docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) (HIGH confidence — official source)
- [WhatsApp ChatStorage.sqlite SQL queries — kacos2000/Queries on GitHub](https://github.com/kacos2000/queries/blob/master/WhatsApp_Chatstorage_sqlite.sql) (HIGH confidence — real schema queries)
- [WhatsApp macOS database location confirmed: group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite on WhatsApp 25.13.74 / macOS 15.4.1](https://apple-stackexchange-com.translate.goog/questions/461817/finding-chat-history-for-whatsapp-for-mac) (HIGH confidence — specific version confirmation)
- [macOS Sequoia Group Containers permission changes — Michael Tsai blog](https://mjtsai.com/blog/2024/09/11/group-container-names-in-sequoia/) (MEDIUM confidence — developer community reporting)
- [Claude Code TCC permission prompt issue — GitHub #36832](https://github.com/anthropics/claude-code/issues/36832) (HIGH confidence — official issue tracker)
- [SQLite WAL read-only requires -shm write access — SQLite Forum](https://sqlite.org/forum/forumpost/908becd5f6) (HIGH confidence — SQLite core team response)
- [SQLite Write-Ahead Logging — official docs](https://sqlite.org/wal.html) (HIGH confidence — official specification)
- [Solving SQLITE_BUSY with WAL mode and busy timeouts](https://coldfusion-example.blogspot.com/2026/01/solving-sqlitebusy-database-is-locked.html) (MEDIUM confidence — community article)
- [Designing MCP servers for wide schemas and large result sets — Axiom](https://axiom.co/blog/designing-mcp-servers-for-wide-events) (MEDIUM confidence — production case study)
- [WhatsApp stores data in accessible location (not sandboxed like iMessage) — @mysk_co on X](https://x.com/mysk_co/status/1808919057120276873) (MEDIUM confidence — security researcher observation, 2024)
