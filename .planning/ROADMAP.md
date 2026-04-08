# Roadmap: WhatsApp MCP Server

## Overview

Three phases build from the ground up: first, a working TypeScript project with a verified read-only database connection, startup safety checks, and a registered MCP server responding over stdio. Second, the three core polling tools that deliver the primary use case — listing chats, fetching messages, and polling for new messages since a timestamp. Third, the extended tool surface: full-text search, contact lookup, chat detail with group members, and media file retrieval. Each phase is independently verifiable before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - TypeScript project, database access, MCP server skeleton, and safety infrastructure (completed 2026-04-07)
- [ ] **Phase 2: Core Tools** - `list_chats`, `get_messages`, and `get_messages_since` tools (primary polling workflow)
- [x] **Phase 3: Extended Tools** - `search_messages`, `get_contact`, `get_chat`, and `get_media_file` tools (completed 2026-04-08)

## Phase Details

### Phase 1: Foundation
**Goal**: A working MCP server registers with Claude Desktop, connects to the WhatsApp SQLite database in read-only snapshot mode, passes all startup safety checks, and is ready for tool implementation
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, MCP-01, MCP-02, MCP-03
**Success Criteria** (what must be TRUE):
  1. Claude Desktop can invoke the server and receive a valid MCP response (e.g., list of registered tools) with no stdout corruption
  2. Server starts and connects to the WhatsApp SQLite database in snapshot mode using `better-sqlite3` `.backup()`; a direct read-only connection is available as an opt-in alternative
  3. On startup, the server validates that expected tables exist and emits a clear human-readable error if the database path is inaccessible or the schema is unexpected
  4. All timestamps returned from the database are converted from Apple Core Data epoch (seconds since 2001-01-01) to ISO 8601
  5. Database path is configurable via environment variable; the server falls back to the known macOS default path
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Project scaffolding, config loader (TOML + env vars), timestamp utility
- [x] 01-02-PLAN.md — Database access layer: snapshot lifecycle, schema validation, connection factory
- [x] 01-03-PLAN.md — MCP server entry point, refresh_snapshot tool, build, Claude Desktop verification

### Phase 2: Core Tools
**Goal**: Claude can list all WhatsApp chats and read messages from any chat — including polling for messages since a given timestamp — covering the primary personal assistant use case
**Depends on**: Phase 1
**Requirements**: TOOL-01, TOOL-02, TOOL-03
**Success Criteria** (what must be TRUE):
  1. Claude can call `list_chats` and receive all chats with contact/group name, last message preview, unread count, and chat ID
  2. Claude can call `get_messages` with a chat ID and receive messages filtered by optional date range and limit, with media metadata (type, filename) included alongside message text
  3. Claude can call `get_messages_since` with a timestamp and receive all new messages across every chat since that time, enabling a polling workflow
**Plans:** 1/2 plans executed

Plans:
- [x] 02-01-PLAN.md — Shared utilities (isoToAppleEpoch, message type map) and list_chats tool
- [ ] 02-02-PLAN.md — get_messages and get_messages_since tools, wire all tools into server

### Phase 3: Extended Tools
**Goal**: Claude can search messages across all chats by keyword, look up contact details, get full chat information including group members, and retrieve media file contents
**Depends on**: Phase 2
**Requirements**: TOOL-04, TOOL-05, TOOL-06, TOOL-07
**Success Criteria** (what must be TRUE):
  1. Claude can call `search_messages` with a keyword and receive matching messages from all chats, using the FTS5 index with automatic LIKE fallback for messages not in the index
  2. Claude can call `get_contact` with a name or phone number and receive the matching contact's details from ContactsV2.sqlite
  3. Claude can call `get_chat` with a chat ID and receive detailed chat info including the list of group members for group chats
  4. Claude can call `get_media_file` with a message ID and receive the media file contents (image, voice note, or document), or a clear error if the file does not exist or exceeds the size limit
**Plans:** 2/2 plans complete

Plans:
- [x] 03-01-PLAN.md — search_messages and get_chat tools (ChatStorage.sqlite queries)
- [x] 03-02-PLAN.md — get_contact, get_media_file tools, and wire all Phase 3 tools into server
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-04-07 |
| 2. Core Tools | 1/2 | In Progress|  |
| 3. Extended Tools | 2/2 | Complete   | 2026-04-08 |
