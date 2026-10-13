import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import Database from "better-sqlite3";
import type { Config } from "../config/loader.js";
import type { DatabaseHandle } from "../db/connection.js";

type Handler = (args: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

/** Register tools on a stub server and call their handlers directly. */
export function toolHarness(dbPath: string, config: Partial<Config> = {}) {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _cfg: unknown, cb: Handler) => handlers.set(name, cb),
  } as unknown as McpServer;
  const db = new Database(dbPath, { readonly: true });
  const handle: DatabaseHandle = { db, mode: "live", snapshotPath: null, createdAt: "", stale: false };
  const fullConfig: Config = { dbPath, mode: "live", snapshotTimeoutSeconds: 60, ...config };
  const getState = async () => ({ config: fullConfig, handle });
  return {
    server,
    getState,
    config: fullConfig,
    async call(name: string, args: object = {}) {
      const h = handlers.get(name);
      if (!h) throw new Error(`tool ${name} not registered`);
      const res = await h(args);
      return JSON.parse(res.content[0].text);
    },
    close: () => db.close(),
  };
}
