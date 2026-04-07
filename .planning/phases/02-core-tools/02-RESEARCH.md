# Phase 02: Core Tools - Research

**Researched:** 2026-04-07
**Domain:** WhatsApp SQLite query layer — MCP tool implementation for `list_chats`, `get_messages`, `get_messages_since`
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `list_chats` returns kitchen sink: chat ID, contact/group name, last message preview, last message timestamp, unread count, chat type (individual/group), participant count, muted status, pinned status
- **D-02:** `get_messages` returns full context per message: sender name, timestamp, text content, message type indicator (text/image/video/voice/doc), media filename if present, is_from_me flag
- **D-03:** All tool responses use structured JSON format (not human-readable text or hybrid)
- **D-04:** Contact name resolution JOINs ZWAPROFILEPUSHNAME for display names (not just raw chat session name)
- **D-05:** `get_messages` default limit is 50 messages when no limit specified
- **D-06:** `list_chats` sorted by most recent message first (matches WhatsApp's own ordering)
- **D-07:** Hard max cap of 1000 messages on all tools, even when caller specifies higher
- **D-08:** When cap is hit, response includes `has_more: true` and the timestamp of the last message returned, enabling cursor-based pagination via follow-up calls
- **D-09:** Empty results return normal JSON structure with empty array plus a brief text note (e.g., "No messages found in this range")
- **D-10:** Media messages (images, voice notes, documents) show type + metadata: message type, filename, file size, and any caption text — enough for Claude to know what was shared without fetching the file
- **D-11:** System messages (group joins/leaves, name changes, encryption notices) included with a 'system' message type flag — Claude can filter if needed
- **D-12:** `get_messages_since` groups results by chat — each chat has name/ID and an array of messages since the timestamp
- **D-13:** `get_messages_since` accepts ISO 8601 string as timestamp input (consistent with INFRA-04 output format)
- **D-14:** `get_messages_since` requires the `since` timestamp parameter — no default lookback window
- **D-15:** Same 1000 message cap applies to `get_messages_since`, with `has_more` + last timestamp pagination

### Claude's Discretion

- Module/file organization for new tool files (follow the pattern from `refresh-snapshot.ts`)
- SQL query structure and JOIN strategy for resolving names, media metadata
- How to detect message type from the ZWAMESSAGE schema fields

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOOL-01 | `list_chats` returns all chats with contact/group name, last message preview, unread count, and chat ID | ZWACHATSESSION schema verified; JOIN strategy to ZWAPROFILEPUSHNAME documented; sort order, field mapping all confirmed |
| TOOL-02 | `get_messages` returns messages from a specific chat with optional date range and limit filters | ZWAMESSAGE schema verified; ZMESSAGETYPE values catalogued from live data; ZWAMEDIAITEM JOIN for media metadata documented |
| TOOL-03 | `get_messages_since` returns messages across all chats since a given timestamp (for polling) | Cross-chat query pattern documented; ISO 8601 input → Apple epoch conversion confirmed; grouping-by-chat design specified in D-12 |
</phase_requirements>

---

## Summary

Phase 2 implements three MCP tools that form the core of the personal assistant workflow. All infrastructure from Phase 1 is in place: the `DatabaseHandle` interface, `appleEpochToISO()` timestamp conversion, `registerXTool()` tool registration pattern, and `getState`/`setState` closure for shared state.

The WhatsApp `ChatStorage.sqlite` schema has been verified directly against a live database on this machine. All four relevant tables (`ZWACHATSESSION`, `ZWAMESSAGE`, `ZWAMEDIAITEM`, `ZWAPROFILEPUSHNAME`) exist and their column names and types are confirmed. The message type integer codes (`ZMESSAGETYPE`) have been catalogued from real data: 0=text, 1=image, 6=voice, 7=sticker, 8=video, 10=document, 2=location, 14=system, 59=poll, 66=reaction/reply.

The critical implementation nuance for Phase 2 is the Apple Core Data epoch offset already handled by `appleEpochToISO()`. For input timestamps (e.g., the `since` parameter in `get_messages_since`), the tool must convert the incoming ISO 8601 string back to Apple epoch seconds before querying SQLite. The `APPLE_EPOCH_OFFSET_SECONDS` constant (978307200) is already exported from `src/utils/time.ts`.

**Primary recommendation:** Add one tool file per tool (`src/tools/list-chats.ts`, `src/tools/get-messages.ts`, `src/tools/get-messages-since.ts`) following the `registerRefreshSnapshotTool` pattern exactly, with SQL queries embedded in the tool file (no separate query layer needed given the small scope). Return all responses as `JSON.stringify(payload)` in the MCP text content field.

---

## Standard Stack

### Core (all established in Phase 1 — no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | `McpServer.registerTool()` with Zod `inputSchema` | Already installed; `registerTool` API confirmed working |
| `better-sqlite3` | 12.8.0 | Synchronous SQLite queries via `DatabaseHandle.db` | Already installed; provides `db.prepare(sql).all(params)` |
| `zod` | 3.25.76 | `inputSchema` for tool parameter validation | Already installed; `z.object({...})` passed as `inputSchema` in `registerTool` config |

**No new npm packages required for Phase 2.**

### Key API Pattern: `registerTool` with `inputSchema`

The `McpServer.registerTool()` API accepts a `config` object with an optional `inputSchema` field. When provided, the SDK validates incoming tool arguments against the Zod schema and passes typed args to the callback:

```typescript
// Source: node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts line 150
registerTool<OutputArgs, InputArgs>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;        // ZodRawShapeCompat (a { [key]: ZodType } shape object)
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
  },
  cb: ToolCallback<InputArgs>       // (args: ShapeOutput<InputArgs>, extra) => CallToolResult
): RegisteredTool
```

The `inputSchema` is a **Zod shape object** (the argument to `z.object()`), NOT a `z.object()` instance:

```typescript
// Correct — pass the shape, not z.object(shape)
server.registerTool("my_tool", {
  inputSchema: {
    chat_id: z.string().describe("The chat ID"),
    limit: z.number().int().min(1).max(1000).default(50).optional(),
  },
  annotations: { readOnlyHint: true },
}, async (args) => { /* args.chat_id, args.limit are typed */ });
```

---

## Architecture Patterns

### Recommended File Layout for Phase 2

Follow the established `refresh-snapshot.ts` pattern. One file per tool in `src/tools/`:

```
src/
├── tools/
│   ├── refresh-snapshot.ts      # Phase 1 — template to follow
│   ├── list-chats.ts            # Phase 2 — TOOL-01
│   ├── get-messages.ts          # Phase 2 — TOOL-02
│   └── get-messages-since.ts    # Phase 2 — TOOL-03
└── utils/
    └── time.ts                  # appleEpochToISO() + APPLE_EPOCH_OFFSET_SECONDS (Phase 1)
```

Three new registrations added to `src/index.ts` main() alongside `registerRefreshSnapshotTool`.

### Pattern 1: Tool Registration (mirrors refresh-snapshot.ts)

```typescript
// Source: established pattern from src/tools/refresh-snapshot.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

export function registerListChatsTool(
  server: McpServer,
  getState: () => { config: Config; handle: DatabaseHandle }
): void {
  server.registerTool(
    "list_chats",
    {
      description: "List all WhatsApp chats ordered by most recent message. Returns chat ID, name, type, unread count, last message preview, and metadata.",
      inputSchema: {
        // No required parameters — lists all chats
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { handle } = getState();
      try {
        // ... SQL query ...
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `list_chats failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
```

### Pattern 2: JSON Response Envelope

All three tools return structured JSON (D-03). Use a consistent envelope:

```typescript
// list_chats response envelope
{
  "chats": [...],
  "total": 693
}

// get_messages response envelope
{
  "messages": [...],
  "chat_id": "...",
  "total_returned": 50,
  "has_more": false,
  "next_cursor": null   // ISO 8601 timestamp of last message when has_more: true
}

// get_messages_since response envelope
{
  "chats": [
    {
      "chat_id": "...",
      "chat_name": "...",
      "messages": [...]
    }
  ],
  "total_messages": 12,
  "has_more": false,
  "next_cursor": null
}

// Empty result (D-09)
{
  "messages": [],
  "total_returned": 0,
  "has_more": false,
  "next_cursor": null,
  "note": "No messages found in this range"
}
```

### Pattern 3: Apple Epoch Timestamp Conversion (Input Direction)

`appleEpochToISO()` handles **output** (DB timestamp → ISO 8601). For **input** (ISO 8601 → DB timestamp) used in `get_messages_since` and date range filtering in `get_messages`:

```typescript
// Source: src/utils/time.ts — APPLE_EPOCH_OFFSET_SECONDS is already exported
import { APPLE_EPOCH_OFFSET_SECONDS } from "../utils/time.js";

function isoToAppleEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000) - APPLE_EPOCH_OFFSET_SECONDS;
}
```

### Pattern 4: SQL Query Structure

All queries use `db.prepare(sql).all(params)` with parameterized `?` placeholders. Never string concatenation.

**list_chats query:**
```sql
SELECT
  cs.Z_PK            AS chat_id,
  cs.ZCONTACTJID     AS jid,
  cs.ZPARTNERNAME    AS partner_name,
  ppn.ZPUSHNAME      AS push_name,
  cs.ZSESSIONTYPE    AS session_type,
  cs.ZUNREADCOUNT    AS unread_count,
  cs.ZLASTMESSAGEDATE AS last_message_date,
  cs.ZLASTMESSAGETEXT AS last_message_text,
  cs.ZMESSAGECOUNT   AS message_count,
  cs.ZARCHIVED       AS is_archived,
  cs.ZCONTACTNAME    AS contact_name
FROM ZWACHATSESSION cs
LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
ORDER BY cs.ZLASTMESSAGEDATE DESC
```

**Resolved display name priority:** `push_name` (from ZWAPROFILEPUSHNAME) > `partner_name` (from ZWACHATSESSION) > `jid` fallback.

**get_messages query:**
```sql
SELECT
  m.Z_PK            AS message_id,
  m.ZTEXT           AS text,
  m.ZMESSAGEDATE    AS message_date,
  m.ZMESSAGETYPE    AS message_type,
  m.ZISFROMME       AS is_from_me,
  m.ZFROMJID        AS from_jid,
  m.ZPUSHNAME       AS sender_name,
  m.ZSTARRED        AS is_starred,
  mi.ZMEDIALOCALPATH AS media_path,
  mi.ZFILESIZE      AS media_file_size,
  mi.ZTITLE         AS media_title
FROM ZWAMESSAGE m
LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
WHERE m.ZCHATSESSION = ?
  AND (? IS NULL OR m.ZMESSAGEDATE >= ?)
  AND (? IS NULL OR m.ZMESSAGEDATE <= ?)
ORDER BY m.ZMESSAGEDATE DESC
LIMIT ?
```

Note: `ZMESSAGEDATE` is Apple epoch seconds. Input `since`/`before` ISO strings must be converted with `isoToAppleEpoch()` before binding.

**get_messages_since query (cross-chat):**
```sql
SELECT
  m.Z_PK            AS message_id,
  m.ZCHATSESSION    AS chat_session_id,
  cs.ZPARTNERNAME   AS chat_name,
  cs.ZCONTACTJID    AS chat_jid,
  ppn.ZPUSHNAME     AS chat_push_name,
  m.ZTEXT           AS text,
  m.ZMESSAGEDATE    AS message_date,
  m.ZMESSAGETYPE    AS message_type,
  m.ZISFROMME       AS is_from_me,
  m.ZPUSHNAME       AS sender_name,
  mi.ZMEDIALOCALPATH AS media_path,
  mi.ZFILESIZE      AS media_file_size,
  mi.ZTITLE         AS media_title
FROM ZWAMESSAGE m
JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
WHERE m.ZMESSAGEDATE > ?
ORDER BY m.ZMESSAGEDATE ASC
LIMIT ?
```

Post-query grouping in TypeScript: collect rows into `Map<chat_session_id, ChatWithMessages>` to produce the D-12 grouped structure.

### Pattern 5: Message Type Mapping

Map `ZMESSAGETYPE` integer to human-readable string in the response layer (not in SQL):

```typescript
const MESSAGE_TYPE_MAP: Record<number, string> = {
  0:  "text",
  1:  "image",
  2:  "location",
  6:  "voice",
  7:  "sticker",
  8:  "video",
  10: "document",
  14: "system",
  59: "poll",
  66: "reaction",
};

function resolveMessageType(typeInt: number): string {
  return MESSAGE_TYPE_MAP[typeInt] ?? `unknown(${typeInt})`;
}
```

### Pattern 6: Pagination Cursor Design (D-07, D-08, D-15)

Hard cap of 1000. When the cap is reached:

```typescript
const CAP = 1000;
const rows = db.prepare(sql).all(...params, CAP + 1) as Row[];
const hasMore = rows.length > CAP;
const returned = hasMore ? rows.slice(0, CAP) : rows;
const nextCursor = hasMore
  ? appleEpochToISO(returned[returned.length - 1].message_date)
  : null;

return {
  content: [{
    type: "text",
    text: JSON.stringify({
      messages: returned.map(formatMessage),
      total_returned: returned.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    }),
  }],
};
```

Query `LIMIT ? + 1` (fetch one extra) to detect whether more results exist without a separate COUNT query.

### Anti-Patterns to Avoid

- **Outputting JSON with `outputSchema` declared:** The SDK requires `structuredContent` alongside `content` when `outputSchema` is set, including in error branches. Per Pitfall 13, avoid `outputSchema` entirely — return structured JSON in the text `content` field. Claude parses it equally well.
- **`INNER JOIN` on optional relations:** ZWAMEDIAITEM and ZWAPROFILEPUSHNAME may not have matching rows. Always `LEFT JOIN` to prevent silently dropping messages/chats that lack media or a push name entry.
- **Unix epoch for input timestamps:** The `since` parameter arrives as ISO 8601 (Unix-compatible). Must subtract `APPLE_EPOCH_OFFSET_SECONDS` before comparing against `ZMESSAGEDATE`.
- **`console.log()` anywhere:** stdout is owned by the MCP stdio transport. All debug output must go to `process.stderr.write()`. This rule is inherited from Phase 1.
- **Throwing exceptions from tool handlers:** Wrap all SQL execution in try/catch and return `{ isError: true, content: [...] }` so Claude sees the error message.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timestamp conversion | Custom epoch math | `appleEpochToISO()` + `APPLE_EPOCH_OFFSET_SECONDS` from `src/utils/time.ts` | Already written, tested, correct offset verified against live data |
| Tool input validation | Manual `if (!args.chat_id)` guards | Zod `inputSchema` in `registerTool` config | SDK validates before calling the handler; type inference is free |
| SQL injection prevention | Custom escaping | `db.prepare(sql).all(params)` parameterized statements | better-sqlite3 handles binding; never string-concat SQL |
| WAL-safe database access | Manual file copy | `DatabaseHandle.db` from `getState()` — already opened on WAL-safe snapshot | Phase 1 solved this; tools just use the handle |
| MCP error responses | Custom error format | `{ content: [...], isError: true }` per established pattern | SDK and Claude both understand this; tested in Phase 1 |

---

## Common Pitfalls

### Pitfall 1: Input timestamp in wrong epoch (Phase-specific)

**What goes wrong:** `get_messages_since` and `get_messages` date filters receive ISO 8601 strings. If the handler passes `new Date(iso).getTime() / 1000` directly as a SQLite parameter (Unix seconds), the comparison against `ZMESSAGEDATE` (Apple epoch seconds) will be wrong by ~31 years — either returning all messages or none.

**Why it happens:** The epoch mismatch is invisible at query time; SQLite doesn't error, it just returns wrong rows.

**How to avoid:** Always use `isoToAppleEpoch(iso)` = `Math.floor(new Date(iso).getTime() / 1000) - APPLE_EPOCH_OFFSET_SECONDS` before binding date parameters.

**Warning signs:** `get_messages_since` with a recent timestamp returns all messages or returns nothing; date range filtering behaves unexpectedly.

### Pitfall 2: INNER JOIN on ZWAMEDIAITEM drops text-only messages

**What goes wrong:** Using `JOIN ZWAMEDIAITEM` instead of `LEFT JOIN ZWAMEDIAITEM` silently filters out all messages that have no media attachment — i.e., the vast majority of messages (17,872 text messages out of 22,892 total). The tool appears to work but returns far fewer messages than exist.

**Why it happens:** `ZWAMESSAGE.ZMEDIAITEM` is NULL for text messages. An `INNER JOIN` requires a match on both sides.

**How to avoid:** Always `LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM`.

**Warning signs:** `get_messages` returns very few messages for an active chat; message count much lower than WhatsApp shows.

### Pitfall 3: `outputSchema` declared without `structuredContent` in all code paths

**What goes wrong:** If `outputSchema` is declared in the `registerTool` config, every return path — including error branches — must return `structuredContent`. Forgetting it in the catch block causes SDK validation errors that surface as protocol-level failures (invisible to Claude).

**Why it happens:** Easy to forget one branch; TypeScript doesn't always catch this at compile time.

**How to avoid:** Per Pitfall 13 from prior research: do not use `outputSchema`. Return structured JSON in the text `content` field. Claude parses it correctly and this avoids the dual-field obligation entirely.

### Pitfall 4: ZWACHATSESSION columns that may not exist

**What goes wrong:** `ZWACHATSESSION` has many columns but not all are present in every WhatsApp version. If the `list_chats` query references a column like `ZMUTED` or `ZPINNED` that doesn't exist in the user's schema version, the query throws `no such column`.

**Why it happens:** WhatsApp updates its schema; Phase 1 validates table existence but not column existence.

**How to avoid:** Before finalizing the `list_chats` query, verify each column used actually exists via `PRAGMA table_info(ZWACHATSESSION)`. For columns that may be version-dependent (muted, pinned, participant count), use `COALESCE(column, default)` or add conditional column detection. Alternatively, run a direct `PRAGMA` check in the query layer and gracefully omit unavailable columns.

**Warning signs:** `list_chats` throws `SqliteError: no such column: ZMUTED` on first invocation.

### Pitfall 5: Contact name resolution when ZWAPROFILEPUSHNAME has no row

**What goes wrong:** `LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID` returns NULL for `ppn.ZPUSHNAME` when the contact has no push name record. If the response layer uses `push_name` directly without a fallback, the chat name appears as `null` in the output.

**How to avoid:** Apply a name resolution priority in the response formatter: `push_name ?? partner_name ?? contact_name ?? jid`. The `ZPARTNERNAME` column in `ZWACHATSESSION` usually has a value even when `ZWAPROFILEPUSHNAME` has no entry.

### Pitfall 6: Group chat participant count from ZWACHATSESSION

**What goes wrong:** `ZWACHATSESSION` may have a `ZMESSAGECOUNT` but may not directly expose a participant count column. Attempting to derive participant count from `ZWACHATSESSION` alone may require a separate query against `ZWAGROUPMEMBER`, which is out of scope for Phase 2.

**How to avoid:** For Phase 2, omit `participant_count` from `list_chats` output or set it to `null` for group chats. This is acceptable — D-01 lists it as a desired field but the query complexity is significant and it can be deferred to Phase 3 (`get_chat` tool). Document the omission in code comments.

---

## Code Examples

### list_chats — verified schema columns from live data

```typescript
// src/tools/list-chats.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { appleEpochToISO } from "../utils/time.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

interface ChatSessionRow {
  chat_id: number;
  jid: string | null;
  partner_name: string | null;
  push_name: string | null;
  contact_name: string | null;
  session_type: number | null;
  unread_count: number | null;
  last_message_date: number | null;
  last_message_text: string | null;
}

const CHAT_LIST_SQL = `
  SELECT
    cs.Z_PK            AS chat_id,
    cs.ZCONTACTJID     AS jid,
    cs.ZPARTNERNAME    AS partner_name,
    ppn.ZPUSHNAME      AS push_name,
    cs.ZCONTACTNAME    AS contact_name,
    cs.ZSESSIONTYPE    AS session_type,
    cs.ZUNREADCOUNT    AS unread_count,
    cs.ZLASTMESSAGEDATE AS last_message_date,
    cs.ZLASTMESSAGETEXT AS last_message_text
  FROM ZWACHATSESSION cs
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
  ORDER BY cs.ZLASTMESSAGEDATE DESC
`;

function resolveDisplayName(row: ChatSessionRow): string {
  return row.push_name ?? row.partner_name ?? row.contact_name ?? row.jid ?? "Unknown";
}

function resolveChatType(sessionType: number | null): string {
  switch (sessionType) {
    case 0: return "individual";
    case 1: return "group";
    case 2: return "broadcast";
    case 3: return "status";
    default: return "unknown";
  }
}

export function registerListChatsTool(
  server: McpServer,
  getState: () => { config: Config; handle: DatabaseHandle }
): void {
  server.registerTool(
    "list_chats",
    {
      description: "List all WhatsApp chats ordered by most recent message first. Returns chat ID, name, type (individual/group/broadcast), unread count, and last message preview.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { handle } = getState();
      try {
        const rows = handle.db.prepare(CHAT_LIST_SQL).all() as ChatSessionRow[];
        const chats = rows.map((row) => ({
          chat_id: row.chat_id,
          name: resolveDisplayName(row),
          jid: row.jid,
          type: resolveChatType(row.session_type),
          unread_count: row.unread_count ?? 0,
          last_message_at: appleEpochToISO(row.last_message_date),
          last_message_preview: row.last_message_text ?? null,
        }));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ chats, total: chats.length }),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `list_chats failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
```

### ISO 8601 → Apple Epoch conversion (input direction)

```typescript
// Add to src/utils/time.ts
import { APPLE_EPOCH_OFFSET_SECONDS } from "./time.js";

export function isoToAppleEpoch(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000) - APPLE_EPOCH_OFFSET_SECONDS;
}
```

### get_messages_since — grouping pattern

```typescript
// Post-query grouping in TypeScript (avoids complex SQL GROUP BY with JSON_GROUP_ARRAY)
const chatMap = new Map<number, { chat_id: number; chat_name: string; messages: MessageOut[] }>();
for (const row of rows) {
  if (!chatMap.has(row.chat_session_id)) {
    chatMap.set(row.chat_session_id, {
      chat_id: row.chat_session_id,
      chat_name: row.chat_push_name ?? row.chat_name ?? row.chat_jid ?? "Unknown",
      messages: [],
    });
  }
  chatMap.get(row.chat_session_id)!.messages.push(formatMessage(row));
}
const chats = Array.from(chatMap.values());
```

### inputSchema for get_messages

```typescript
inputSchema: {
  chat_id: z.number().int().describe("The chat ID from list_chats"),
  limit: z.number().int().min(1).max(1000).default(50).optional()
    .describe("Number of messages to return (default: 50, max: 1000)"),
  since: z.string().optional()
    .describe("ISO 8601 timestamp — return only messages after this time"),
  before: z.string().optional()
    .describe("ISO 8601 timestamp — return only messages before this time"),
},
```

### inputSchema for get_messages_since

```typescript
inputSchema: {
  since: z.string()
    .describe("ISO 8601 timestamp — required. Return all messages across all chats after this time."),
},
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| MCP `tool()` method (deprecated) | `registerTool()` with config object | New API is the only non-deprecated path in SDK 1.29.0 |
| `outputSchema` + `structuredContent` | Structured JSON in text `content` field | Simpler; avoids dual-field obligation; Claude handles JSON in text equally well |
| Separate query layer (queries/ dir) | SQL embedded in tool file | For 3 small tools, co-location reduces indirection without sacrificing readability |

---

## Open Questions

1. **ZWACHATSESSION column availability for muted/pinned status**
   - What we know: D-01 requests muted and pinned status; these columns exist in some schema versions
   - What's unclear: Whether `ZMUTED` and `ZPINNED` exist in the current schema without running `PRAGMA table_info`
   - Recommendation: In the first plan wave, add a pre-flight `PRAGMA table_info(ZWACHATSESSION)` check and document available columns. Omit muted/pinned from V1 output if columns are absent; add them conditionally in a follow-up.

2. **Participant count for group chats**
   - What we know: `ZWAGROUPMEMBER` table exists; it requires a separate query per group chat
   - What's unclear: Whether a single SQL query can efficiently join participant count without N+1 queries
   - Recommendation: Omit `participant_count` from Phase 2 `list_chats` output (set to `null`). Add it in Phase 3 `get_chat` where a focused single-chat query is appropriate.

3. **ZMESSAGETYPE values not in the known catalogue**
   - What we know: 10 type values catalogued from 22,892 messages
   - What's unclear: Edge cases for newer message types (link previews, contact cards, etc.)
   - Recommendation: The `unknown(N)` fallback in `resolveMessageType()` handles unknown values gracefully without failing.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 adds no new external dependencies. All required tools (Node.js 25.8.1, better-sqlite3 12.8.0, MCP SDK 1.29.0, Zod 3.25.76) were verified available in Phase 1.

---

## Project Constraints (from CLAUDE.md)

- **Tech stack:** TypeScript/Node.js with `@modelcontextprotocol/sdk` only — no new runtime dependencies for Phase 2
- **Access:** Read-only — all SQL is `SELECT`; no `INSERT`, `UPDATE`, `DELETE`; `DatabaseHandle` opened with `readonly: true`
- **Platform:** macOS only — `ChatStorage.sqlite` path is macOS-specific (already resolved in Phase 1 config)
- **Privacy:** No external API calls — all data stays local; no network access in tool handlers
- **stdout:** Never write to stdout except via MCP JSON-RPC responses — use `process.stderr.write()` for diagnostics
- **Errors:** Runtime tool errors returned as `{ isError: true, content: [...] }`, never thrown
- **Annotations:** All tools must have `annotations: { readOnlyHint: true }` per MCP-02

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of live WhatsApp `ChatStorage.sqlite` on development machine — `ZWAMESSAGE`, `ZWACHATSESSION`, `ZWAMEDIAITEM`, `ZWAPROFILEPUSHNAME` table structure and ZMESSAGETYPE values confirmed from live data
- `src/tools/refresh-snapshot.ts` — working `registerTool` pattern with `getState`/`setState`
- `src/db/connection.ts` — `DatabaseHandle` interface
- `src/utils/time.ts` — `appleEpochToISO()` and `APPLE_EPOCH_OFFSET_SECONDS`
- `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` — `registerTool` type signature confirmed directly
- `.planning/research/FEATURES.md` — ZMESSAGETYPE catalogue, schema columns verified from live data
- `.planning/research/PITFALLS.md` — Pitfall 7 (isError pattern), Pitfall 8 (LIMIT enforcement), Pitfall 9 (epoch mismatch), Pitfall 13 (outputSchema obligation)

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — SQL query patterns and JOIN strategy
- `02-CONTEXT.md` — All D-01 through D-15 decisions (locked by user)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all verified in Phase 1
- SQL schema: HIGH — verified from live database directly
- Architecture patterns: HIGH — mirrors working Phase 1 code
- Edge cases (muted/pinned columns, participant count): MEDIUM — require PRAGMA verification at implementation time

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable schema; WhatsApp auto-updates could change columns)
