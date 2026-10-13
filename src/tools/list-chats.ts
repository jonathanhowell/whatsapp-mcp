import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config/loader.js";
import type { DatabaseHandle } from "../db/connection.js";
import { appleEpochToISO } from "../utils/time.js";

interface ChatSessionRow {
  chat_id: number;
  jid: string | null;
  partner_name: string | null;
  push_name: string | null;
  session_type: number | null;
  unread_count: number | null;
  last_message_date: number | null;
  last_message_text: string | null;
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

const LIST_CHATS_SQL = `
  SELECT
    cs.Z_PK            AS chat_id,
    cs.ZCONTACTJID     AS jid,
    cs.ZPARTNERNAME    AS partner_name,
    ppn.ZPUSHNAME      AS push_name,
    cs.ZSESSIONTYPE    AS session_type,
    cs.ZUNREADCOUNT    AS unread_count,
    cs.ZLASTMESSAGEDATE AS last_message_date,
    cs.ZLASTMESSAGETEXT AS last_message_text
  FROM ZWACHATSESSION cs
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
  ORDER BY cs.ZLASTMESSAGEDATE DESC
`;

export function registerListChatsTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "list_chats",
    {
      description:
        "List all WhatsApp chats ordered by most recent message first. Returns chat ID, name, type (individual/group/broadcast), unread count, and last message preview.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { handle } = await getState();
      try {
        const rows = handle.db.prepare(LIST_CHATS_SQL).all() as ChatSessionRow[];

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { chats: [], total: 0, note: "No chats found" },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const chats = rows.map((row) => ({
          chat_id: row.chat_id,
          name:
            row.push_name ??
            row.partner_name ??
            row.jid ??
            "Unknown",
          jid: row.jid,
          type: resolveChatType(row.session_type),
          unread_count: row.unread_count ?? 0,
          last_message_at: appleEpochToISO(row.last_message_date),
          last_message_preview: row.last_message_text ?? null,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ chats, total: chats.length }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to list chats: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
