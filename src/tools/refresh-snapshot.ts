import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseManager } from "../db/manager.js";

export function registerRefreshSnapshotTool(
  server: McpServer,
  manager: DatabaseManager
): void {
  server.registerTool(
    "refresh_snapshot",
    {
      description:
        "Create a fresh snapshot of the WhatsApp database. Use this to get the latest messages without restarting the server, or to retry after a snapshot_pending / snapshot_failed status. If the refresh fails, the previous snapshot stays in use.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (manager.config.mode === "live") {
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
        const handle = await manager.refresh();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ok",
                  snapshot_path: handle.snapshotPath,
                  created_at: handle.createdAt,
                  message:
                    "Snapshot refreshed successfully. Database now reflects the latest WhatsApp messages.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        const current = manager.current;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "snapshot_failed",
                  message: `Failed to refresh snapshot: ${message}`,
                  still_serving: current
                    ? { snapshot_path: current.snapshotPath, created_at: current.createdAt }
                    : null,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
