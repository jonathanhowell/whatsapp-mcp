# Phase 1: Foundation - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

A working MCP server that registers with Claude Desktop, connects to the WhatsApp SQLite database in read-only snapshot mode, passes all startup safety checks, and is ready for tool implementation. Includes project scaffolding, database access layer, snapshot management, configuration system, and error handling infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Snapshot Lifecycle
- **D-01:** Snapshot created at server startup using `better-sqlite3` `.backup()` from a read-only connection on the live DB
- **D-02:** A `refresh_snapshot` MCP tool allows Claude to request a fresh snapshot on demand without restarting the server
- **D-03:** Snapshots stored in `os.tmpdir()` (e.g., `/tmp/whatsapp-mcp/`)
- **D-04:** Server auto-cleans old snapshot files from prior sessions on startup before creating a new one

### Error Messaging
- **D-05:** Error messages are actionable and concise — short message with exactly what to do to fix it (e.g., "WhatsApp database not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security.")
- **D-06:** Startup errors go to stderr (visible in Claude Desktop logs); runtime errors returned as MCP error responses so Claude sees them and can relay to the user
- **D-07:** If the database is completely inaccessible at startup, the server exits with a clear error message (fail fast — no point running without a database)

### Configuration Design
- **D-08:** Database mode (snapshot vs live) configurable via both environment variables and a TOML config file
- **D-09:** Config file format is TOML, located at `~/.config/whatsapp-mcp/config.toml`
- **D-10:** Environment variables take precedence over config file values (standard convention — lets Claude Desktop config override TOML without editing it)
- **D-11:** TOML parsing requires adding a dependency (e.g., `@iarna/toml` or similar)

### Claude's Discretion
- Project file/module structure (db layer vs MCP layer vs utils) — Claude has flexibility to organize as best fits the implementation

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `CLAUDE.md` — Tech stack decisions, library versions, WhatsApp database location, version compatibility, and stack patterns
- `.planning/REQUIREMENTS.md` — INFRA-01 through INFRA-06 and MCP-01 through MCP-03 define this phase's requirements
- `.planning/ROADMAP.md` — Phase 1 success criteria and scope boundary

No external specs — requirements fully captured in decisions above and project documents.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no source code exists yet

### Established Patterns
- None yet — this phase establishes the foundational patterns all future phases build on

### Integration Points
- Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`) — server must be registerable here
- WhatsApp SQLite database (`~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite`) — read-only access target
- stdio transport — MCP communication channel

</code_context>

<specifics>
## Specific Ideas

- User wants snapshot-at-startup plus on-demand refresh (hybrid approach) rather than pure startup-only or per-call snapshots
- Config supports both env vars and TOML file, with env vars winning on conflicts — allows quick overrides in Claude Desktop config without touching the TOML file
- TOML chosen over JSON (no comments) and YAML (indentation fragility) for config format

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-07*
