# WhatsApp MCP Server

> **macOS only** — reads from the native WhatsApp Desktop app's SQLite database.

A read-only [MCP](https://modelcontextprotocol.io) server that gives Claude access to your WhatsApp messages. It reads directly from the WhatsApp Desktop database on macOS, so all data stays local on your machine.

## Requirements

- **macOS** (no Windows/Linux support — relies on the macOS WhatsApp Desktop app)
- [WhatsApp Desktop](https://apps.apple.com/app/whatsapp-messenger/id310633997) (native Mac app, not the web version)
- Node.js >= 20

## Install

```bash
git clone https://github.com/jonathanhowell/whatsapp-mcp.git
cd whatsapp-mcp
npm install
npm run build
```

## Setup

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "whatsapp-mcp": {
      "command": "node",
      "args": ["/path/to/whatsapp-mcp/build/index.js"]
    }
  }
}
```

Or for Claude Code, add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "whatsapp-mcp": {
      "command": "node",
      "args": ["/path/to/whatsapp-mcp/build/index.js"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `list_chats` | List all chats with metadata |
| `get_messages` | Get messages from a specific chat |
| `get_messages_since` | Poll for new messages since a timestamp |
| `search_messages` | Search messages by keyword |
| `get_chat` | Get chat details including group members |
| `get_contact` | Look up a contact by name or phone number |
| `get_media_file` | Retrieve an image, PDF/document, voice note or video. Copies it to `$TMPDIR/whatsapp-mcp/media/` and returns `{path, mime_type, byte_size}` (or base64 with `inline: true`, ≤ 5 MB). Reports `status`: `ok` / `no_media` / `not_downloaded` / `missing` |
| `refresh_snapshot` | Re-snapshot the database for fresh data |

## Message format

`get_messages`, `get_messages_since` and `search_messages` return messages shaped like:

```json
{
  "message_id": 32931,
  "timestamp": "2026-09-10T13:07:00.000Z",
  "type": "image",
  "is_from_me": false,
  "sender_name": "Alex",
  "text": "caption or message text",
  "media": { "filename": null, "file_size": 137588 }
}
```

- `text` holds the message text, **or the caption** for images, videos, GIFs, voice notes and
  documents. `search_messages` matches captions too.
- `media.filename` is the real filename (the document title for documents) or `null`. It is
  never the caption. Use `get_media_file` to fetch the file.

### Message types

| `type` | Notes |
|--------|-------|
| `text`, `image`, `video`, `audio`, `gif`, `sticker`, `video_note` | Captions are in `text` |
| `document` | `text` = caption, `media.filename` = document title |
| `link` | Text with a link preview: `link: {url, title}` |
| `contact` | Shared contact card: `contact: {name, vcard}`; `text` = name |
| `location` | `location: {latitude, longitude}` |
| `call` | Voice/video call event: `call: {direction, video, duration_seconds, outcome, missed}`; `text` is a summary such as `"Missed voice call"` |
| `poll` | `poll: {question, options: [{name, votes}], max_selections}`; `text` lists the options |
| `template`, `interactive` | WhatsApp Business messages; `text` is decoded from the message body |
| `album` | Header row for a group of photos (the images follow as separate messages) |
| `deleted` | "This message was deleted" |
| `system`, `group_event` | Chat notices (E2E-encryption banner, joins/leaves, …) |
| `list_response`, `button_response`, `group_invite` | Business replies, group invite links |
| `unknown(N)` | Rare types with no identified user content |

Reactions are not separate messages. WhatsApp stores them on the message being reacted to, so
they appear as `reactions: [{emoji, from_me, sender_jid, timestamp}]` on that message (the key
is omitted when there are none).

## Configuration

Works out of the box with defaults. Optionally configure via `~/.config/whatsapp-mcp/config.toml`:

```toml
# Database mode: "snapshot" (default, safe) or "live" (direct reads)
mode = "snapshot"

# Override database path (rarely needed)
# db_path = "/path/to/ChatStorage.sqlite"

# Abort a snapshot copy that takes longer than this (default 60)
# snapshot_timeout_seconds = 60
```

Environment variables override the config file:

- `WHATSAPP_DB_MODE` — `snapshot` or `live`
- `WHATSAPP_DB_PATH` — path to the WhatsApp SQLite database
- `WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS` — snapshot deadline

### Snapshot vs Live mode

- **Snapshot** (default): Creates a copy of the database before reading. Safe and recommended — avoids lock contention with WhatsApp.
- **Live**: Reads the database directly. Faster, but may encounter `SQLITE_BUSY` errors if WhatsApp is writing.

### Startup and snapshot lifecycle

- The server answers the MCP handshake immediately; the snapshot is built in the background
  (in a worker thread, with a deadline). Tool calls wait up to 20 s for it, then return a
  structured status instead of data:
  - `{"status": "snapshot_pending", ...}` — still copying; retry shortly.
  - `{"status": "snapshot_failed", "message": "snapshot failed: <reason>", ...}` — call
    `refresh_snapshot` (or any tool) to retry.
- If a fresh snapshot fails but an earlier good one exists, tools serve it and append a
  `WARNING: serving a stale snapshot captured <time>` text item to the result.
- The copy uses SQLite's online backup in a single step (one read transaction, so writes by
  WhatsApp can't restart it), falling back to `VACUUM INTO`. The live database is only ever
  opened read-only.
- Each server instance writes its own `snapshot-<pid>.sqlite` under `$TMPDIR/whatsapp-mcp/`,
  via a `.tmp` file that is renamed into place. Files are only cleaned up once their owning
  process has exited, so concurrent instances never delete each other's snapshot.
- `$TMPDIR/whatsapp-mcp/latest.sqlite` is a symlink to the most recent good snapshot from any
  instance, and is kept even after that instance exits. Use it as an offline fallback:

  ```bash
  sqlite3 "file:$TMPDIR/whatsapp-mcp/latest.sqlite?immutable=1" "SELECT count(*) FROM ZWAMESSAGE"
  ```

## Troubleshooting

- **Every tool returns `snapshot_failed` mentioning `NODE_MODULE_VERSION`**: Node.js was
  upgraded (e.g. by Homebrew) and the `better-sqlite3` native module must be rebuilt:
  `npm rebuild better-sqlite3`, then restart the MCP client.
- **`Cannot open WhatsApp database`**: grant Full Disk Access to the app that launches the
  server (Terminal, Claude, or the launchd job's binary).

## Privacy

All data stays on your machine. No external API calls. The server is strictly read-only — it cannot modify your WhatsApp data.

## License

MIT
