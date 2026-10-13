<!-- GSD:project-start source:PROJECT.md -->
## Project

**WhatsApp MCP Server**

A read-only MCP server that gives Claude Code access to WhatsApp messages by reading from the native macOS WhatsApp Desktop app's SQLite database. It supports both direct database reads and snapshot copies, exposing tools for listing chats, fetching messages, searching, polling for new messages, and retrieving media files. Built in TypeScript using the official MCP SDK.

**Core Value:** Claude can read WhatsApp messages to extract actionable tasks and answer questions about conversations — acting as an input channel for a personal assistant workflow.

### Constraints

- **Tech stack**: TypeScript/Node.js with @modelcontextprotocol/sdk
- **Access**: Read-only — no mutations to the WhatsApp database
- **Platform**: macOS only (native WhatsApp Desktop app)
- **Privacy**: All data stays local, no external API calls
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Runtime and dependencies
| Package | Version | Role |
|---------|---------|------|
| Node.js | >= 20 | Runtime. `better-sqlite3` is a native module: **run `npm rebuild better-sqlite3` after every Node upgrade**, or the server fails with a `NODE_MODULE_VERSION` error |
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server, `StdioServerTransport`. Do not use the v2 alpha |
| `better-sqlite3` | 12.8.0 | Synchronous SQLite access; every WhatsApp DB is opened `readonly: true` |
| `zod` | ^3.25 | Tool input schemas (SDK peer dep; do not install zod 4 separately) |
| `smol-toml` | 1.6.1 | Parses `~/.config/whatsapp-mcp/config.toml` |
| TypeScript | 5.x | `module`/`moduleResolution: Node16`, ESM (`"type": "module"`), `.js` import suffixes |
## Build, run, test
- Build: `npm run build` (plain `tsc`) → `build/index.js`. There is no tsup/`dist/`
- MCP clients run `node /path/to/whatsapp-mcp/build/index.js`; rebuild after source changes and reconnect the client (`/mcp` → Reconnect in Claude Code)
- Tests: `npm test` (`tsx --test 'src/**/*.test.ts'`, Node's built-in `node:test` + `node:assert/strict`)
- Typecheck incl. tests: `npm run typecheck` (`tsconfig.test.json`; the build `tsconfig.json` excludes tests)
## SQLite rules
- Live DB: `readonly: true, fileMustExist: true, timeout: 0` (fail fast on SQLITE_BUSY)
- Snapshots: `db.backup()` **in a single step** (progress callback returns > totalPages). The default 100-pages-per-step backup releases the read transaction between steps and restarts from page 0 on every WhatsApp write; under steady writes it never finishes
- Fallback copy: `VACUUM INTO` (works on a read-only connection, one read transaction)
- Never `fs.copyFile` a live WAL database
- Offline reads: `sqlite3 "file:$TMPDIR/whatsapp-mcp/latest.sqlite?immutable=1"`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Code
- ESM TypeScript with explicit `.js` suffixes on relative imports
- One file per MCP tool in `src/tools/`, exporting `registerXxxTool(server, getState)`
- Tools call `const { config, handle } = await getState()` **before** their `try` block, so a `DatabaseUnavailableError` propagates to the server wrapper and becomes a structured `snapshot_pending` / `snapshot_failed` result
- Tool results are `{ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] }`; failures add `isError: true`
- SQL lives in module-level template-string constants with `AS snake_case` aliases matching a row interface
- Message rows are never formatted inline in tools: use `MESSAGE_COLUMNS` / `MESSAGE_JOINS` / `formatMessages()` from `src/messages/format.ts`
- Comments explain WhatsApp schema facts (which field holds what, and how it was verified), not what the code does
- The db layer throws; it never calls `process.exit`
## Read-only and privacy
- Never open a WhatsApp database writable. The only writable DB is our own snapshot temp file
- No network calls. Media that WhatsApp has not downloaded is reported as `not_downloaded`, never fetched
- Output changes are additive; tool names and input parameters are a public contract
## Tests
- `node:test` + `node:assert/strict`, colocated as `*.test.ts`
- `src/test/fixtures.ts`: `makeFakeChatStorage()` builds a minimal ChatStorage-shaped DB; `pb()` encodes protobuf fixtures; `deadPid()` for ownership tests
- `src/test/tool-harness.ts`: register tools on a stub server and call handlers directly
- **Fixtures must use synthetic data only**: no real names, message text, document titles, locations or JIDs from a real database. Use `1000000000000NN@lid` and UK fictional numbers (`447700900xxx`)
## Commits
- One commit per logical fix; conventional prefixes (`fix:`, `feat:`, `docs:`); the body explains root cause and evidence
- Commit messages may cite internal message/chat IDs and counts, never message content or names
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Startup
- `src/index.ts`: load config → create `DatabaseManager` → register tools → `server.connect(StdioServerTransport)` **first** → `manager.start()` builds the database in the background. The MCP handshake never waits on the database
- Exits cleanly (and removes its own non-latest snapshot) when stdin / the transport closes or on SIGTERM/SIGINT
## Database layer (`src/db/`)
- `manager.ts`, `DatabaseManager`: owns the handle and state (pending / ready / failed). `acquire()` waits up to 20 s for an in-flight open, then throws `DatabaseUnavailableError`. `refresh()` keeps the old handle if the new snapshot fails. With no handle at all, it serves `latest.sqlite` marked stale
- `snapshot.ts`: per-instance `snapshot-<pid>.sqlite` in `$TMPDIR/whatsapp-mcp/`; copy to `.tmp` → `renameSync` → repoint the `latest.sqlite` symlink → only then clean files whose owner pid is dead (never the `latest` target)
- `snapshot-worker.ts`: runs in a `worker_thread` so the deadline (`worker.terminate()`) is enforceable; single-step backup, restart cap, `VACUUM INTO` fallback, then `journal_mode=DELETE` so the snapshot is one self-contained file
- `connection.ts`: open snapshot/live handles, validate schema, `explainDbError()` (native-module ABI mismatch, Full Disk Access, SQLITE_BUSY)
- `server.ts` wraps `registerTool` so every callback turns `DatabaseUnavailableError` into a structured result and appends a stale-snapshot warning when relevant
## Message pipeline (`src/messages/`)
- `format.ts`: shared SQL columns/joins and `formatMessages(db, rows, names)`: type mapping, caption/filename split, call/poll/template/link/contact/location decoding, reactions, and batched `quoted` lookup by `ZSTANZAID` within the same chat
- `names.ts`, `NameResolver` (cached per handle): address book (ContactsV2) → push names (incl. lid↔pn via LID.sqlite) → LID display name; sender precedence is group contact name → resolver → 1:1 partner name
- `src/utils/protobuf.ts`: schema-less reader for `ZMETADATA` / `ZRECEIPTINFO` blobs
- `src/utils/time.ts`: Core Data epoch conversion and `MESSAGE_TYPE_MAP`
## Tools (`src/tools/`)
| Tool | Notes |
|------|-------|
| `list_chats`, `get_chat` | Chat list / details; group member names via `NameResolver` |
| `get_messages`, `get_messages_since`, `search_messages` | All share `src/messages/format.ts`; search matches text and captions |
| `get_media_file` | `resolveMedia()` classifies ok / no_media / not_downloaded / missing (re-checks the live DB for paths newer than the snapshot); `exportMedia()` copies to `$TMPDIR/whatsapp-mcp/media/` |
| `get_contact` | Reads ContactsV2.sqlite directly (no snapshot needed) |
| `refresh_snapshot` | `manager.refresh()` |
## WhatsApp schema knowledge
- See `docs/SCHEMA.md` for message types, protobuf field layouts, reactions, replies, calls, polls and name sources, all verified against a real database
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
