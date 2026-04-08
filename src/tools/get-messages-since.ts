import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appleEpochToISO, isoToAppleEpoch, resolveMessageType } from "../utils/time.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

interface CrossChatRow {
  message_id: number;
  chat_session_id: number;
  chat_name: string | null;
  chat_jid: string | null;
  chat_push_name: string | null;
  text: string | null;
  message_date: number | null;
  message_type: number;
  is_from_me: number;
  sender_name: string | null;
  media_path: string | null;
  media_file_size: number | null;
  media_title: string | null;
}

const GET_MESSAGES_SINCE_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZCHATSESSION    AS chat_session_id,
    cs.ZPARTNERNAME   AS chat_name,
    cs.ZCONTACTJID    AS chat_jid,
    ppn.ZPUSHNAME     AS chat_push_name,
    m.ZTEXT           AS text,
    m.ZMESSAGEDATE    AS message_date,
    m.ZMESSAGETYPE    AS message_type,
    m.ZISFROMME       AS is_from_me,
    COALESCE(NULLIF(gm.ZCONTACTNAME, ''), sender_ppn.ZPUSHNAME, m.ZPUSHNAME) AS sender_name,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title
  FROM ZWAMESSAGE m
  JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
  LEFT JOIN ZWAPROFILEPUSHNAME sender_ppn ON sender_ppn.ZJID = gm.ZMEMBERJID
  WHERE m.ZMESSAGEDATE > ?
  ORDER BY m.ZMESSAGEDATE ASC
  LIMIT ?
`;

export function registerGetMessagesSinceTool(
  server: McpServer,
  getState: () => { config: Config; handle: DatabaseHandle }
): void {
  server.registerTool(
    "get_messages_since",
    {
      description:
        "Get all messages across all WhatsApp chats since a given timestamp. Results grouped by chat. Use for polling new messages.",
      inputSchema: {
        since: z.string().describe(
          "ISO 8601 timestamp (required). Return all messages across all chats after this time."
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { handle } = getState();

        const CAP = 1000;
        const sinceApple = isoToAppleEpoch(args.since);

        const rows = handle.db.prepare(GET_MESSAGES_SINCE_SQL).all(
          sinceApple,
          CAP + 1
        ) as CrossChatRow[];

        const hasMore = rows.length > CAP;
        const returned = hasMore ? rows.slice(0, CAP) : rows;
        const nextCursor = hasMore
          ? appleEpochToISO(returned[returned.length - 1].message_date)
          : null;

        if (returned.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    chats: [],
                    total_messages: 0,
                    has_more: false,
                    next_cursor: null,
                    note: "No new messages since the specified time",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const chatMap = new Map<
          number,
          { chat_id: number; chat_name: string; messages: object[] }
        >();

        for (const row of returned) {
          if (!chatMap.has(row.chat_session_id)) {
            chatMap.set(row.chat_session_id, {
              chat_id: row.chat_session_id,
              chat_name:
                row.chat_push_name ?? row.chat_name ?? row.chat_jid ?? "Unknown",
              messages: [],
            });
          }
          chatMap.get(row.chat_session_id)!.messages.push({
            message_id: row.message_id,
            timestamp: appleEpochToISO(row.message_date),
            type: resolveMessageType(row.message_type),
            is_from_me: row.is_from_me === 1,
            sender_name: row.sender_name ?? null,
            text: row.text ?? null,
            media:
              row.media_path || row.media_title || row.media_file_size
                ? {
                    filename: row.media_title ?? null,
                    file_size: row.media_file_size ?? null,
                  }
                : null,
          });
        }

        const chats = Array.from(chatMap.values());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chats,
                  total_messages: returned.length,
                  has_more: hasMore,
                  next_cursor: nextCursor,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to get messages since: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
