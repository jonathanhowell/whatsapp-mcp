# WhatsApp MCP Server

## What This Is

A read-only MCP server that gives Claude Code access to WhatsApp messages by reading from the native macOS WhatsApp Desktop app's SQLite database. It supports both direct database reads and snapshot copies, exposing tools for listing chats, fetching messages, searching, polling for new messages, and retrieving media files. Built in TypeScript using the official MCP SDK.

## Core Value

Claude can read WhatsApp messages to extract actionable tasks and answer questions about conversations — acting as an input channel for a personal assistant workflow.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] List all chats with contact/group names
- [ ] Fetch messages from a specific chat with date and limit filters
- [ ] Full-text search across all chats by keyword
- [ ] Fetch messages since a given timestamp (polling for new messages)
- [ ] Return media metadata (type, filename) alongside message text
- [ ] Separate tool to retrieve/serve media files (images, voice notes, documents)
- [ ] Support reading from live WhatsApp SQLite database (native macOS app)
- [ ] Support reading from a snapshot copy of the database
- [ ] Configurable database path (live DB or snapshot location)

### Out of Scope

- Writing/sending messages — read-only access only
- WhatsApp Web or Electron app support — native macOS app only
- Real-time push notifications — polling-based, not event-driven
- Message decryption — relies on the desktop app's already-decrypted local database
- Multi-account support — single WhatsApp account

## Context

- The user runs Claude Code as a home personal assistant that manages tasks via markdown files
- WhatsApp messages are an input channel: new messages may contain actionable items or progress updates against existing tasks
- The native macOS WhatsApp app stores messages in a SQLite database (location and schema need research)
- The desktop app may lock the database while running, so snapshot copy support is important for reliability
- This is a local-only tool — no cloud APIs, no WhatsApp Business API

## Constraints

- **Tech stack**: TypeScript/Node.js with @modelcontextprotocol/sdk
- **Access**: Read-only — no mutations to the WhatsApp database
- **Platform**: macOS only (native WhatsApp Desktop app)
- **Privacy**: All data stays local, no external API calls

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + official MCP SDK | Best ecosystem support for MCP servers | — Pending |
| Read-only access | Safety — never risk corrupting WhatsApp data | — Pending |
| Snapshot + live DB support | Live DB may be locked; snapshots are safer for concurrent access | — Pending |
| Separate media tool | Keep message listing lightweight; fetch media on demand | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-07 after initialization*
