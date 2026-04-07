import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createServer(): McpServer {
  return new McpServer({ name: "whatsapp-mcp", version: "1.0.0" });
}
