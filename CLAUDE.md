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

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | 1.29.0 (stable) | MCP server framework — tools, stdio transport, schema validation | The official Anthropic/MCP SDK. Only production-stable option; v2 alpha is not ready. Handles all MCP protocol concerns so the project focuses on WhatsApp logic. |
| `better-sqlite3` | 12.8.0 | Synchronous read-only SQLite access | Fastest Node.js SQLite library. Synchronous API eliminates async complexity that adds no value for read-only queries. Native `readonly: true` flag prevents accidental writes. Supports `.backup()` for safe snapshot creation from a live WAL-mode database. |
| `zod` | 3.25+ (v3 series) | MCP tool schema validation + input parsing | Required by `@modelcontextprotocol/sdk` for tool parameter schemas. SDK 1.x internally imports `zod/v4` but requires Zod v3.25+ as peer dep. Provides runtime validation and TypeScript inference from a single schema definition. |
| `TypeScript` | 5.x | Type safety, IDE support | Required per project constraints. Pairs with Zod for end-to-end type safety from schema to query result. |
| `Node.js` | 20 LTS or 22 LTS | Runtime | `@modelcontextprotocol/sdk` requires `>=20`. Both are supported by `better-sqlite3` 12.x. Node 22 LTS preferred for longer support horizon. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/better-sqlite3` | Latest | TypeScript type definitions for better-sqlite3 | Always — dev dependency for type checking queries and results |
| `tsx` | Latest | Run TypeScript directly during development | Development only — `tsx src/index.ts` for fast iteration without a build step |
| `tsup` | Latest | Bundle TypeScript to single executable JS file | For the final distributable build. Zero-config, esbuild-powered, outputs CJS with source maps. MCP servers are commonly distributed as compiled JS. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `tsconfig.json` | TypeScript compilation config | Target `ES2022`, `module: Node16` or `NodeNext` for proper ESM/CJS handling with `@modelcontextprotocol/sdk` |
| `tsx` | Development hot-reload / single-file runner | `tsx watch src/index.ts` for iteration; no build step during development |
| `tsup` | Production build | `tsup src/index.ts --format cjs --dts` — produces `dist/index.js` referenced in Claude Desktop config |
## Installation
# Core runtime dependencies
# Type definitions
# Development and build tools
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `better-sqlite3` | `node:sqlite` (built-in Node.js module) | NOT yet — as of Node.js 22/25, `node:sqlite` remains experimental (required `--experimental-sqlite` flag through Node 22; flag dropped in 25 but API still marked experimental). Not production-ready in April 2026. Revisit when Node.js stable channel ships it as stable. |
| `better-sqlite3` | `sqlite3` (async npm package) | Only if you have a specific need for async parallel query execution. For read-only sequential queries in an MCP server, async adds complexity with no throughput benefit. `better-sqlite3` outperforms it even in async scenarios due to `sqlite3`'s mutex thrashing. |
| `better-sqlite3` | `prisma` or `drizzle` | Only if you need migrations, schema management, or multi-database support. ORM overhead is unnecessary for read-only access to a fixed third-party schema. |
| `@modelcontextprotocol/sdk` v1.x (stable) | v2.0.0-alpha | Do not use alpha. v2 is a monorepo restructure (splits into `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, etc.) and is in alpha as of April 2026. v1.x receives bug fixes for at least 6 months post-v2 stable release. |
| `tsup` | `tsc` directly | Use `tsc` if you only need type checking and a simple output; `tsup` is better for a single-file executable distribution. Either works for this project. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `sqlite3` (npm package) | Async API causes mutex thrashing that degrades performance vs synchronous access. No native `readonly` flag. Significantly more complex for query-result handling. | `better-sqlite3` |
| `node:sqlite` built-in | Experimental as of April 2026. API is subject to breaking changes in future Node.js versions. No `@types` package. Missing features like `.backup()`. | `better-sqlite3` |
| `@modelcontextprotocol/sdk` v2.0.0-alpha | Alpha software — breaking changes guaranteed before stable release. Package names changed, import paths different. | `@modelcontextprotocol/sdk` 1.29.0 |
| `fs.copyFileSync` for DB snapshots | Unsafe for WAL-mode SQLite. Copying just the `.sqlite` file without the `.wal` and `.shm` files produces an inconsistent snapshot. Race conditions with live writes. | `better-sqlite3`'s `.backup(destination)` method, which uses SQLite's `sqlite3_backup` API for transactionally consistent copies |
| WhatsApp Business API / cloud APIs | Out of scope per project constraints. This project reads the local desktop app's database directly — no cloud dependency. | Direct SQLite file access |
## Stack Patterns by Variant
- Open with `readonly: true` and `fileMustExist: true`
- Set `timeout: 0` to fail fast on SQLITE_BUSY rather than hang — WhatsApp may hold exclusive locks
- Handle `SQLITE_BUSY` errors gracefully and instruct user to use snapshot mode
- Use `better-sqlite3`'s `.backup(snapshotPath)` from a `readonly: true` connection on the live DB — this is the correct WAL-aware copy mechanism
- Open snapshot with `readonly: true, fileMustExist: true`
- No locking concerns — WhatsApp does not hold locks on the copy
- Compile to `dist/index.js` with `tsup`
- Register in `~/Library/Application Support/Claude/claude_desktop_config.json` as:
- Use `StdioServerTransport` — this is the correct transport for Claude Desktop (not HTTP/SSE)
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.29.0` | `zod@3.25+` | SDK 1.x imports `zod/v4` internally but requires Zod 3.25+ as peer dep. Do NOT install `zod@4.x` separately — use 3.25+ which includes the `zod/v4` compatibility shim. |
| `better-sqlite3@12.8.0` | Node.js 20.x, 22.x, 23.x, 24.x, 25.x | Prebuilt native binaries available for all LTS versions. Requires native module rebuild if Node version changes (`npm rebuild better-sqlite3`). |
| `@modelcontextprotocol/sdk@1.29.0` | Node.js >=20 | Hard engine requirement. Node 18 LTS is not supported. |
## WhatsApp Database Location (macOS)
- `ZWAMESSAGE` — message records
- `ZWAMEDIAITEM` — media attachment metadata
- `ZWACHATSESSION` — chat sessions (the chat list)
- `ZWAPROFILEPUSHNAME` — contact display names
## Sources
- [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) — SDK releases, server.md docs, package.json (HIGH confidence)
- [github.com/modelcontextprotocol/typescript-sdk/releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — v1.29.0 confirmed as latest stable (HIGH confidence)
- [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — version 12.8.0, Node.js support matrix, API docs (HIGH confidence)
- [github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `readonly`, `fileMustExist`, `.backup()` options (HIGH confidence)
- [github.com/WiseLibs/better-sqlite3/discussions/1245](https://github.com/WiseLibs/better-sqlite3/discussions/1245) — Node.js built-in `node:sqlite` vs better-sqlite3 comparison (MEDIUM confidence)
- [nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html) — Node.js built-in SQLite module, experimental status confirmed (HIGH confidence)
- [group-ib.com/blog/whatsapp-forensic-artifacts](https://www.group-ib.com/blog/whatsapp-forensic-artifacts/) — macOS DB path under Library/Group Containers (MEDIUM confidence)
- [github.com/kacos2000/queries](https://github.com/kacos2000/queries/blob/master/WhatsApp_Chatstorage_sqlite.sql) — ChatStorage.sqlite table structure (MEDIUM confidence)
- WebSearch results for `better-sqlite3 WAL mode backup` and `MCP server TypeScript stdio 2025` (MEDIUM confidence)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
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
