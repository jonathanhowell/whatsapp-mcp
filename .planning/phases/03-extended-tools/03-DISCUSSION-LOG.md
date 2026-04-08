# Phase 3: Extended Tools - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 03-extended-tools
**Areas discussed:** Search strategy, Media retrieval, Contact & chat detail

---

## Search Strategy

### Result Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by chat (Recommended) | Results grouped by chat (like get_messages_since) — each chat shows matching messages | ✓ |
| Flat ranked list | All matching messages in a single list sorted by relevance or date | |
| Grouped + context | Grouped by chat, with 1-2 surrounding messages around each match | |

**User's choice:** Grouped by chat
**Notes:** None

### FTS5 vs LIKE

| Option | Description | Selected |
|--------|-------------|----------|
| FTS5 first, LIKE fallback | Try FTS5 for speed, then LIKE for uncovered messages | |
| Always LIKE | Skip FTS5 entirely — LIKE across all messages | ✓ |
| FTS5 only + warn | Use FTS5 only and note results may be incomplete | |

**User's choice:** Always LIKE
**Notes:** User asked about LIKE performance at various DB sizes. At ~23K messages, LIKE is instant. Since FTS5 only covers 21% of messages, LIKE fallback is required anyway — FTS5 adds complexity with no benefit. Two code paths + deduplication + inconsistent ranking across combined results makes it not worth it.

### Result Content

| Option | Description | Selected |
|--------|-------------|----------|
| Full message text (Recommended) | Return complete message text for each match | ✓ |
| Snippet with highlight | Truncated excerpt around the match (~100 chars) | |

**User's choice:** Full message text
**Notes:** None

---

## Media Retrieval

### Return Format

| Option | Description | Selected |
|--------|-------------|----------|
| Base64 in response | Encode file as base64 inline in MCP response | |
| File path only | Return absolute file path on disk | |
| Base64 with size gate | Base64 under threshold, file path for larger files | ✓ |

**User's choice:** Base64 with size gate
**Notes:** None

### Size Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 5 MB (Recommended) | Covers most photos, voice notes, short videos | ✓ |
| 1 MB | Conservative — only small images and voice notes inlined | |
| 10 MB | Generous — higher-res photos and longer voice notes | |

**User's choice:** 5 MB
**Notes:** None

### Missing Media Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Metadata + clear error (Recommended) | Return DB metadata plus "file not found" message, not isError | ✓ |
| isError response | Return MCP error response | |
| You decide | Claude's discretion | |

**User's choice:** Metadata + clear error
**Notes:** None

---

## Contact & Chat Detail

### Contact Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| Second DB connection (Recommended) | Open ContactsV2.sqlite read-only for full contact details | ✓ |
| ChatStorage only | Use ZWAPROFILEPUSHNAME and ZWACHATSESSION only | |
| You decide | Claude's discretion based on feasibility | |

**User's choice:** Second DB connection
**Notes:** None

### Group Member Detail

| Option | Description | Selected |
|--------|-------------|----------|
| Member list with names (Recommended) | Each member's JID and resolved display name | ✓ |
| Member count only | Just the number of members | |
| Full member profiles | JID, name, phone, admin status with ContactsV2 cross-ref | |

**User's choice:** Member list with names
**Notes:** None

---

## Claude's Discretion

- SQL query structure and JOIN strategy for all new tools
- ContactsV2.sqlite path discovery and schema validation
- MIME type detection for media files
- Case sensitivity behavior for search
- Module/file organization (follow existing pattern)

## Deferred Ideas

None — discussion stayed within phase scope
