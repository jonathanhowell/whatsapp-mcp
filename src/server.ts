import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DatabaseUnavailableError,
  type DatabaseManager,
} from "./db/manager.js";

// Tools that don't read the message database don't need the stale warning.
const NO_DB_TOOLS = new Set(["get_contact", "refresh_snapshot"]);

export function createServer(manager: DatabaseManager): McpServer {
  const server = new McpServer({ name: "whatsapp-mcp", version: "1.1.0" });

  // Wrap every tool callback so that (a) a missing database becomes a
  // structured snapshot_pending / snapshot_failed result instead of an
  // exception, and (b) results served from a stale snapshot say so.
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: (...a: unknown[]) => Promise<any>) =>
    register(name, config as any, (async (...args: unknown[]) => {
      try {
        const result = await cb(...args);
        const warning = NO_DB_TOOLS.has(name) ? null : manager.staleWarning();
        if (warning && result && Array.isArray(result.content)) {
          result.content.push({ type: "text", text: warning });
        }
        return result;
      } catch (err) {
        if (err instanceof DatabaseUnavailableError) return err.toToolResult();
        throw err;
      }
    }) as any)) as typeof server.registerTool;

  return server;
}
