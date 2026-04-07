# Phase 2: Core Tools - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 02-core-tools
**Areas discussed:** Response content, Default behaviors, Message types, Polling design

---

## Response Content

### list_chats detail level

| Option | Description | Selected |
|--------|-------------|----------|
| Rich (Recommended) | Chat ID, contact/group name, last message preview, last message timestamp, unread count | |
| Minimal | Chat ID and contact/group name only | |
| Kitchen sink | Everything above plus chat type, participant count, muted status, pinned status | ✓ |

**User's choice:** Kitchen sink
**Notes:** User wants maximum detail per chat entry.

### get_messages detail level

| Option | Description | Selected |
|--------|-------------|----------|
| Full context (Recommended) | Sender name, timestamp, text content, message type indicator, media filename, is_from_me flag | ✓ |
| Text-focused | Sender name, timestamp, text content only | |
| Maximum detail | All of Full context plus reply-to reference, read receipt status, starred flag, message ID | |

**User's choice:** Full context (Recommended)
**Notes:** None

### Response format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON (Recommended) | JSON objects with typed fields | ✓ |
| Human-readable text | Pre-formatted text blocks | |
| Hybrid | JSON data with summary text field | |

**User's choice:** Structured JSON (Recommended)
**Notes:** None

### Contact name resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Join push names (Recommended) | JOIN ZWAPROFILEPUSHNAME for contact display names | ✓ |
| Chat session name only | Use ZWACHATSESSION.ZPARTNERNAME | |
| You decide | Claude picks best approach | |

**User's choice:** Join push names (Recommended)
**Notes:** None

---

## Default Behaviors

### Default message limit

| Option | Description | Selected |
|--------|-------------|----------|
| 50 messages (Recommended) | Enough context without overwhelming context window | ✓ |
| 100 messages | More history, uses more tokens | |
| No default limit | Return all messages | |

**User's choice:** 50 messages (Recommended)
**Notes:** None

### Sort order for list_chats

| Option | Description | Selected |
|--------|-------------|----------|
| Most recent first (Recommended) | Newest messages at top, matches WhatsApp ordering | ✓ |
| Alphabetical | By contact/group name | |
| Unread first | Unread chats first, then by recency | |

**User's choice:** Most recent first (Recommended)
**Notes:** None

### Hard max cap

| Option | Description | Selected |
|--------|-------------|----------|
| Cap at 500 (Recommended) | Safety valve for context window | |
| No cap | Trust the caller | |
| Cap at 200 | Conservative, smaller responses | |

**User's choice:** Cap at 1000 (custom)
**Notes:** User specified cap at 1000 instead of the offered options.

### Empty results

| Option | Description | Selected |
|--------|-------------|----------|
| Empty array with note (Recommended) | Normal JSON structure with empty array and brief text note | ✓ |
| Empty array only | Empty array, no explanation | |
| Distinct empty response | Different response shape with no_results flag | |

**User's choice:** Empty array with note (Recommended)
**Notes:** None

---

## Message Types

### Media messages

| Option | Description | Selected |
|--------|-------------|----------|
| Type + metadata (Recommended) | Message type, filename, file size, caption text | ✓ |
| Placeholder text | Descriptive text like '[Image: sunset.jpg]' | |
| You decide | Claude picks based on schema | |

**User's choice:** Type + metadata (Recommended)
**Notes:** None

### System messages

| Option | Description | Selected |
|--------|-------------|----------|
| Include with type flag (Recommended) | Include with 'system' message type, Claude can filter | ✓ |
| Exclude by default | Filter out unless caller opts in | |
| Include as-is | No special handling | |

**User's choice:** Include with type flag (Recommended)
**Notes:** None

---

## Polling Design

### Result grouping

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by chat (Recommended) | Messages organized by chat, each with name/ID and message array | ✓ |
| Flat chronological list | All messages in one timeline with chat info on each | |
| You decide | Claude picks most efficient approach | |

**User's choice:** Grouped by chat (Recommended)
**Notes:** None

### Timestamp input format

| Option | Description | Selected |
|--------|-------------|----------|
| ISO 8601 string (Recommended) | Accept '2026-04-07T10:00:00Z' — consistent with INFRA-04 output | ✓ |
| Unix epoch seconds | Numeric seconds since 1970 | |
| Both formats | Auto-detect either format | |

**User's choice:** ISO 8601 string (Recommended)
**Notes:** None

### Default lookback window

| Option | Description | Selected |
|--------|-------------|----------|
| Last 24 hours (Recommended) | Default for 'what's new' workflow | |
| Require timestamp | Make since parameter mandatory | ✓ |
| Last 1 hour | Shorter default for frequent polling | |

**User's choice:** Require timestamp
**Notes:** User prefers no magic default — explicit timestamp required.

### Polling cap

| Option | Description | Selected |
|--------|-------------|----------|
| Same 1000 cap (Recommended) | Consistent with get_messages, includes has_more + timestamp pagination | ✓ |
| Lower cap (200) | Smaller pages for polling | |
| No cap | Return everything since timestamp | |

**User's choice:** Same 1000 cap (Recommended)
**Notes:** User asked about truncation signaling — confirmed response will include has_more=true and last message timestamp when cap is hit, enabling cursor-based pagination.

---

## Claude's Discretion

- Module/file organization for new tool files
- SQL query structure and JOIN strategy
- Message type detection from ZWAMESSAGE schema fields

## Deferred Ideas

None — discussion stayed within phase scope
