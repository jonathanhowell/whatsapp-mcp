# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 01-foundation
**Areas discussed:** Snapshot lifecycle, Error messaging, Configuration design

---

## Snapshot Lifecycle

### When to create/refresh snapshots

| Option | Description | Selected |
|--------|-------------|----------|
| Once at startup | Server creates snapshot at boot, all tool calls use it until restart | |
| On every tool call | Fresh snapshot before each tool invocation | |
| On demand via a tool | Add a refresh_snapshot tool for Claude to call when needed | |

**User's choice:** Hybrid — snapshot at startup, plus a `refresh_snapshot` tool when fresh data is required
**Notes:** User combined startup + on-demand approaches

### Snapshot storage location

| Option | Description | Selected |
|--------|-------------|----------|
| OS temp directory | Store in os.tmpdir() (e.g., /tmp/whatsapp-mcp/) | ✓ |
| Project directory | Store in .snapshots/ folder alongside server | |
| Configurable path | User sets snapshot location via env var | |

**User's choice:** OS temp directory
**Notes:** None

### Snapshot cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, auto-cleanup | Delete previous snapshot files from prior sessions on startup | ✓ |
| No, let OS handle it | Rely on OS temp file cleanup | |
| You decide | Claude picks best approach | |

**User's choice:** Yes, auto-cleanup
**Notes:** None

---

## Error Messaging

### Error verbosity

| Option | Description | Selected |
|--------|-------------|----------|
| Actionable + concise | Short error message with exactly what to do to fix it | ✓ |
| Detailed diagnostic | Include path checked, OS version, permission state, step-by-step fix | |
| Minimal | Just the error type and code | |

**User's choice:** Actionable + concise
**Notes:** None

### Error destination

| Option | Description | Selected |
|--------|-------------|----------|
| Both stderr + MCP responses | Startup errors to stderr, runtime errors as MCP error responses | ✓ |
| Stderr only | All errors to stderr, Claude gets generic failure | |
| MCP responses only | Errors in tool responses, no stderr logging | |

**User's choice:** Both
**Notes:** None

### Startup failure behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Exit with error | Fail fast — exit process with clear error message | ✓ |
| Stay running, error per call | Server stays up, every tool call returns DB error | |
| You decide | Claude picks best approach | |

**User's choice:** Exit with error
**Notes:** None

---

## Configuration Design

### Database mode configuration

| Option | Description | Selected |
|--------|-------------|----------|
| Env var only | WHATSAPP_MCP_MODE=snapshot\|live | |
| Env var + config file | Support both env var and config file | ✓ |
| CLI flags | Pass --mode as args in Claude Desktop command config | |

**User's choice:** Env var + config file
**Notes:** None

### Config file format

| Option | Description | Selected |
|--------|-------------|----------|
| JSON | Native to Node.js, no extra dependency, no comments | |
| TOML | Supports comments, clean flat syntax, needs parsing library | ✓ |
| YAML | Supports comments, expressive, indentation-sensitive | |

**User's choice:** TOML
**Notes:** User asked for comparison between TOML and YAML before deciding. Chose TOML for its flat syntax and resilience to indentation errors.

### Config file location

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.config/whatsapp-mcp/config.toml | XDG-style user config dir | ✓ |
| Next to server binary | config.toml in same directory as built server | |
| Configurable via env var | WHATSAPP_MCP_CONFIG=/path/to/config.toml | |

**User's choice:** ~/.config/whatsapp-mcp/config.toml
**Notes:** None

### Precedence

| Option | Description | Selected |
|--------|-------------|----------|
| Env var wins | Standard convention — env vars override config file | ✓ |
| Config file wins | TOML file is source of truth | |
| You decide | Claude picks standard approach | |

**User's choice:** Env var wins
**Notes:** None

---

## Claude's Discretion

- Project file/module structure (db layer vs MCP layer vs utils)

## Deferred Ideas

None — discussion stayed within phase scope
