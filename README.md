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
| `get_media_file` | Retrieve a media attachment as base64 |
| `refresh_snapshot` | Re-snapshot the database for fresh data |

## Configuration

Works out of the box with defaults. Optionally configure via `~/.config/whatsapp-mcp/config.toml`:

```toml
# Database mode: "snapshot" (default, safe) or "live" (direct reads)
mode = "snapshot"

# Override database path (rarely needed)
# db_path = "/path/to/ChatStorage.sqlite"
```

Environment variables override the config file:

- `WHATSAPP_DB_MODE` — `snapshot` or `live`
- `WHATSAPP_DB_PATH` — path to the WhatsApp SQLite database

### Snapshot vs Live mode

- **Snapshot** (default): Creates a copy of the database before reading. Safe and recommended — avoids lock contention with WhatsApp.
- **Live**: Reads the database directly. Faster, but may encounter `SQLITE_BUSY` errors if WhatsApp is writing.

## Privacy

All data stays on your machine. No external API calls. The server is strictly read-only — it cannot modify your WhatsApp data.

## License

MIT
