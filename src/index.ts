import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/loader.js";
import { DatabaseManager } from "./db/manager.js";
import { createServer } from "./server.js";
import { registerRefreshSnapshotTool } from "./tools/refresh-snapshot.js";
import { registerListChatsTool } from "./tools/list-chats.js";
import { registerGetMessagesTool } from "./tools/get-messages.js";
import { registerGetMessagesSinceTool } from "./tools/get-messages-since.js";
import { registerSearchMessagesTool } from "./tools/search-messages.js";
import { registerGetChatTool } from "./tools/get-chat.js";
import { registerGetContactTool } from "./tools/get-contact.js";
import { registerGetMediaFileTool } from "./tools/get-media-file.js";
import type { Config } from "./config/loader.js";

async function main(): Promise<void> {
  const config: Config = loadConfig();
  process.stderr.write(`WhatsApp MCP: Mode=${config.mode}, DB=${config.dbPath}\n`);

  const manager = new DatabaseManager(config, {
    snapshotTimeoutMs: config.snapshotTimeoutSeconds * 1000,
  });
  const server = createServer(manager);

  // State accessor for tools: waits briefly for the snapshot, then throws a
  // DatabaseUnavailableError that the server wrapper turns into a status.
  const getState = async () => ({ config, handle: await manager.acquire() });

  registerRefreshSnapshotTool(server, manager);
  registerListChatsTool(server, getState);
  registerGetMessagesTool(server, getState);
  registerGetMessagesSinceTool(server, getState);
  registerSearchMessagesTool(server, getState);
  registerGetChatTool(server, getState);
  registerGetContactTool(server, () => config);
  registerGetMediaFileTool(server, getState);

  // Connect FIRST: the handshake must never wait on the database.
  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    manager.close();
    process.exit(0);
  };
  transport.onclose = shutdown;
  process.stdin.on("end", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await server.connect(transport);
  process.stderr.write("WhatsApp MCP: Server running on stdio\n");

  void manager.start();
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
