import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appleEpochToISO, isoToAppleEpoch } from "../utils/time.js";
import {
  MESSAGE_COLUMNS,
  MESSAGE_JOINS,
  formatMessages,
  type MessageRow,
} from "../messages/format.js";
import { getNameResolver } from "../messages/names.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

interface CrossChatRow extends MessageRow {
  chat_name: string | null;
  chat_push_name: string | null;
}

const GET_MESSAGES_SINCE_SQL = `
  SELECT${MESSAGE_COLUMNS},
    cs.ZPARTNERNAME   AS chat_name,
    ppn.ZPUSHNAME     AS chat_push_name
  FROM ZWAMESSAGE m
  JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID${MESSAGE_JOINS}
  WHERE m.ZMESSAGEDATE > ?
  ORDER BY m.ZMESSAGEDATE ASC
  LIMIT ?
`;

export function registerGetMessagesSinceTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "get_messages_since",
    {
      description:
        "Get all messages across all WhatsApp chats since a given timestamp. Results grouped by chat. Use for polling new messages. Each chat group has chat_id and its stable chat_jid. Messages have the same shape as get_messages (stanza_id; captions in text; call, poll, link, contact, location details; reactions).",
      inputSchema: {
        since: z.string().describe(
          "ISO 8601 timestamp (required). Return all messages across all chats after this time."
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { config, handle } = await getState();
      const names = getNameResolver(handle, config.dbPath);
      try {

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
          { chat_id: number; chat_jid: string | null; chat_name: string; messages: object[] }
        >();

        const formatted = formatMessages(handle.db, returned, names);
        returned.forEach((row, i) => {
          if (!chatMap.has(row.chat_session_id)) {
            chatMap.set(row.chat_session_id, {
              chat_id: row.chat_session_id,
              chat_jid: row.chat_jid,
              chat_name:
                row.chat_push_name ?? row.chat_name ?? row.chat_jid ?? "Unknown",
              messages: [],
            });
          }
          chatMap.get(row.chat_session_id)!.messages.push(formatted[i]);
        });

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
