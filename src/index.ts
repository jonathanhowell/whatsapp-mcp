import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/loader.js";
import { openDatabase, type DatabaseHandle } from "./db/connection.js";
import { createServer } from "./server.js";
import { registerRefreshSnapshotTool } from "./tools/refresh-snapshot.js";
import type { Config } from "./config/loader.js";

async function main(): Promise<void> {
  const config: Config = loadConfig();
  process.stderr.write(`WhatsApp MCP: Mode=${config.mode}, DB=${config.dbPath}\n`);

  let handle = await openDatabase(config);

  const server = createServer();

  // State accessors for tools
  const getState = () => ({ config, handle });
  const setState = (newHandle: DatabaseHandle) => {
    handle = newHandle;
  };

  registerRefreshSnapshotTool(server, getState, setState);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("WhatsApp MCP: Server running on stdio\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
