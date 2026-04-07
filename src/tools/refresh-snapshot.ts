import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config/loader.js";
import {
  refreshSnapshot,
  type DatabaseHandle,
} from "../db/connection.js";

export function registerRefreshSnapshotTool(
  server: McpServer,
  getState: () => { config: Config; handle: DatabaseHandle },
  setState: (handle: DatabaseHandle) => void
): void {
  server.registerTool(
    "refresh_snapshot",
    {
      description:
        "Create a fresh snapshot of the WhatsApp database. Use this to get the latest messages without restarting the server.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { config, handle } = getState();
      if (handle.mode === "live") {
        return {
          content: [
            {
              type: "text",
              text: "Server is in live mode — no snapshot to refresh. Database reads are already against the live file.",
            },
          ],
        };
      }
      try {
        const newHandle = await refreshSnapshot(config, handle);
        setState(newHandle);
        return {
          content: [
            {
              type: "text",
              text: "Snapshot refreshed successfully. Database now reflects the latest WhatsApp messages.",
            },
          ],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to refresh snapshot: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
