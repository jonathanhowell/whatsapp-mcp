---
phase: 03-extended-tools
plan: "02"
subsystem: tools
tags: [get-contact, get-media-file, server-wiring, ContactsV2, base64, mcp-tools]
dependency_graph:
  requires: ["03-01"]
  provides: ["TOOL-05", "TOOL-07", "full-v1-tool-surface"]
  affects: ["src/index.ts", "src/tools/get-contact.ts", "src/tools/get-media-file.ts"]
tech_stack:
  added: []
  patterns:
    - "Per-call SQLite connection for ContactsV2.sqlite (open in try, close in finally)"
    - "5 MB size gate for media file inline delivery vs file_path reference"
    - "config.dbPath for media base path (not handle.snapshotPath)"
key_files:
  created:
    - src/tools/get-contact.ts
    - src/tools/get-media-file.ts
  modified:
    - src/index.ts
decisions:
  - "ContactsV2.sqlite opened per-call (no timeout:0 — infrequently written, no lock contention)"
  - "Missing media file returns metadata response (not isError) per D-06"
  - "Media base path derived from config.dbPath not handle.snapshotPath (snapshots don't include media)"
metrics:
  duration: "~2 min"
  completed: "2026-04-08"
  tasks_completed: 3
  files_changed: 3
---

# Phase 3 Plan 02: get_contact, get_media_file, and Server Wiring Summary

**One-liner:** Contact lookup from ContactsV2.sqlite with per-call connection, media file retrieval with 5 MB base64 gate, and all eight MCP tools wired into the server entry point.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create get_contact tool | 0d0fe91 | src/tools/get-contact.ts (created) |
| 2 | Create get_media_file tool | 1cbdaf2 | src/tools/get-media-file.ts (created) |
| 3 | Wire all Phase 3 tools into server | 50385ea | src/index.ts (modified) |

## What Was Built

### get_contact (TOOL-05)

Searches `ContactsV2.sqlite` by name or phone number using LIKE queries against `ZWAADDRESSBOOKCONTACT`. Key behaviors:

- Path derived via `path.dirname(config.dbPath)` alongside the main database per D-07
- `fs.existsSync` check before opening — returns clear error if database not yet created by WhatsApp Desktop
- Opens a fresh `readonly: true, fileMustExist: true` connection per call, closes in `finally` block
- No `timeout: 0` — ContactsV2 is infrequently written, no lock contention expected
- LIKE escaping matches `search_messages` pattern
- Returns up to 20 contacts with `contact_id`, `full_name`, `phone_number`, `localized_phone`, `whatsapp_jid`, `business_name`

### get_media_file (TOOL-07)

Retrieves media files from WhatsApp messages with a 5 MB inline gate. Key behaviors:

- JOINs `ZWAMESSAGE` with `ZWAMEDIAITEM` to resolve `ZMEDIALOCALPATH`
- No JOIN result → `isError: true` ("no media attachment")
- File not on disk → metadata response (not `isError`) per D-06 — file may have been deleted or not downloaded
- File over 5 MB → `{ inline: false, file_path: ... }` (path reference only)
- File under 5 MB → `{ inline: true, data: "<base64>" }` with `content_type` from MIME_TYPES map
- Media base path: `path.join(path.dirname(config.dbPath), "Message")` — uses `config.dbPath` not `handle.snapshotPath` (snapshots don't include media files)

### Server Wiring (index.ts)

All eight MCP tools now registered:
1. `refresh_snapshot` (Phase 1)
2. `list_chats` (Phase 2)
3. `get_messages` (Phase 2)
4. `get_messages_since` (Phase 2)
5. `search_messages` (Phase 3, Plan 01)
6. `get_chat` (Phase 3, Plan 01)
7. `get_contact` (Phase 3, Plan 02 — this plan)
8. `get_media_file` (Phase 3, Plan 02 — this plan)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All tools connect to real data sources (ContactsV2.sqlite, ZWAMESSAGE/ZWAMEDIAITEM, live filesystem).

## Self-Check: PASSED

- src/tools/get-contact.ts: FOUND
- src/tools/get-media-file.ts: FOUND
- src/index.ts: FOUND (all 8 tools wired)
- Commit 0d0fe91: FOUND
- Commit 1cbdaf2: FOUND
- Commit 50385ea: FOUND
- npx tsc --noEmit: exits 0 (clean compile)
