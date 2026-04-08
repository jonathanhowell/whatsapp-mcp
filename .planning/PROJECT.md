# WhatsApp MCP Server

## What This Is

A read-only MCP server that gives Claude Code access to WhatsApp messages by reading from the native macOS WhatsApp Desktop app's SQLite database. It supports both direct database reads and snapshot copies, exposing tools for listing chats, fetching messages, searching, polling for new messages, and retrieving media files. Built in TypeScript using the official MCP SDK.

## Core Value

Claude can read WhatsApp messages to extract actionable tasks and answer questions about conversations — acting as an input channel for a personal assistant workflow.

## Requirements

### Validated

- [x] Support reading from live WhatsApp SQLite database (native macOS app) — Validated in Phase 1: Foundation
- [x] Support reading from a snapshot copy of the database — Validated in Phase 1: Foundation
- [x] Configurable database path (live DB or snapshot location) — Validated in Phase 1: Foundation
- [x] List all chats with contact/group names — Validated in Phase 2: Core Tools
- [x] Fetch messages from a specific chat with date and limit filters — Validated in Phase 2: Core Tools
- [x] Fetch messages since a given timestamp (polling for new messages) — Validated in Phase 2: Core Tools
- [x] Return media metadata (type, filename) alongside message text — Validated in Phase 2: Core Tools
- [x] Full-text search across all chats by keyword — Validated in Phase 3: Extended Tools
- [x] Look up contact details by name or phone — Validated in Phase 3: Extended Tools
- [x] Retrieve detailed chat info including group members — Validated in Phase 3: Extended Tools
- [x] Retrieve media files (images, voice notes, documents) by message ID — Validated in Phase 3: Extended Tools

### Active

No active requirements remaining for v1.

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
| TypeScript + official MCP SDK | Best ecosystem support for MCP servers | Validated Phase 1 |
| Read-only access | Safety — never risk corrupting WhatsApp data | Validated Phase 1 |
| Snapshot + live DB support | Live DB may be locked; snapshots are safer for concurrent access | Validated Phase 1 |
| Separate media tool | Keep message listing lightweight; fetch media on demand | Validated Phase 3 |
| LIKE search over FTS5 | Research decision D-01: LIKE-only search simpler and sufficient for local DB sizes | Validated Phase 3 |
| ContactsV2.sqlite per-call open | Contacts DB may not exist; open/close per call avoids startup failures | Validated Phase 3 |

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
*Last updated: 2026-04-08 after Phase 3 completion — all 8 MCP tools operational (list_chats, get_messages, get_messages_since, refresh_snapshot, search_messages, get_chat, get_contact, get_media_file)*
