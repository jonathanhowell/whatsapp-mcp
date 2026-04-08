# Requirements: WhatsApp MCP Server

**Defined:** 2026-04-07
**Core Value:** Claude can read WhatsApp messages to extract actionable tasks and answer questions about conversations

## v1 Requirements

### Core Tools

- [x] **TOOL-01**: `list_chats` returns all chats with contact/group name, last message preview, unread count, and chat ID
- [x] **TOOL-02**: `get_messages` returns messages from a specific chat with optional date range and limit filters
- [x] **TOOL-03**: `get_messages_since` returns messages across all chats since a given timestamp (for polling)
- [x] **TOOL-04**: `search_messages` performs full-text search across all chats using FTS5 index with LIKE fallback

### Extended Tools

- [x] **TOOL-05**: `get_contact` looks up contact details (name, phone number) by name or phone
- [x] **TOOL-06**: `get_chat` returns detailed chat info including group members for group chats
- [x] **TOOL-07**: `get_media_file` retrieves a media file (image, voice note, document) by message ID

### Infrastructure

- [x] **INFRA-01**: Server auto-discovers WhatsApp SQLite database path at startup and validates expected tables exist
- [x] **INFRA-02**: Snapshot mode copies database files atomically before reading (default mode)
- [x] **INFRA-03**: Live DB mode reads directly from WhatsApp database (opt-in alternative)
- [x] **INFRA-04**: All Apple Core Data epoch timestamps converted to ISO 8601 in tool responses
- [x] **INFRA-05**: Startup permission checks with clear human-readable errors for macOS TCC/access failures
- [x] **INFRA-06**: Database path configurable via environment variable or server config

### MCP Server

- [x] **MCP-01**: Server runs over stdio transport using `@modelcontextprotocol/sdk`
- [x] **MCP-02**: All tools annotated with `readOnlyHint: true` for auto-approval
- [x] **MCP-03**: No writes to stdout except MCP JSON-RPC protocol messages

## v2 Requirements

### Enhancements

- **ENH-01**: Message type indicators (image, video, voice note, document, poll, reaction) in message responses
- **ENH-02**: Pagination support for large chat histories
- **ENH-03**: Chat filtering by type (individual, group, broadcast)
- **ENH-04**: Message thread/reply chain resolution

## Out of Scope

| Feature | Reason |
|---------|--------|
| Sending/writing messages | Read-only access only — safety constraint |
| WhatsApp Web/Electron app support | Native macOS app only |
| Real-time push notifications | Polling-based design, not event-driven |
| Multi-account support | Single WhatsApp account |
| Message decryption | Relies on desktop app's already-decrypted local DB |
| Windows/Linux support | macOS only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOOL-01 | Phase 2 | Complete |
| TOOL-02 | Phase 2 | Complete |
| TOOL-03 | Phase 2 | Complete |
| TOOL-04 | Phase 3 | Complete |
| TOOL-05 | Phase 3 | Complete |
| TOOL-06 | Phase 3 | Complete |
| TOOL-07 | Phase 3 | Complete |
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| INFRA-06 | Phase 1 | Complete |
| MCP-01 | Phase 1 | Complete |
| MCP-02 | Phase 1 | Complete |
| MCP-03 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after roadmap creation*
