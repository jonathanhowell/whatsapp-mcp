import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appleEpochToISO, isoToAppleEpoch, resolveMessageType } from "../utils/time.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

interface MessageRow {
  message_id: number;
  text: string | null;
  message_date: number | null;
  message_type: number;
  is_from_me: number;
  from_jid: string | null;
  sender_name: string | null;
  is_starred: number | null;
  media_path: string | null;
  media_file_size: number | null;
  media_title: string | null;
}

const GET_MESSAGES_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZTEXT           AS text,
    m.ZMESSAGEDATE    AS message_date,
    m.ZMESSAGETYPE    AS message_type,
    m.ZISFROMME       AS is_from_me,
    m.ZFROMJID        AS from_jid,
    COALESCE(NULLIF(gm.ZCONTACTNAME, ''), sender_ppn.ZPUSHNAME, m.ZPUSHNAME) AS sender_name,
    m.ZSTARRED        AS is_starred,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title
  FROM ZWAMESSAGE m
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
  LEFT JOIN ZWAPROFILEPUSHNAME sender_ppn ON sender_ppn.ZJID = gm.ZMEMBERJID
  WHERE m.ZCHATSESSION = ?
    AND (? IS NULL OR m.ZMESSAGEDATE >= ?)
    AND (? IS NULL OR m.ZMESSAGEDATE <= ?)
  ORDER BY m.ZMESSAGEDATE DESC
  LIMIT ?
`;

export function registerGetMessagesTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "get_messages",
    {
      description:
        "Get messages from a specific WhatsApp chat. Returns messages with sender, timestamp, text, type, and media metadata. Supports date range filtering and pagination.",
      inputSchema: {
        chat_id: z.number().int().describe("The chat ID from list_chats"),
        limit: z.number().int().min(1).max(1000).default(50).optional()
          .describe("Number of messages to return (default: 50, max: 1000)"),
        since: z.string().optional()
          .describe("ISO 8601 timestamp — return only messages after this time"),
        before: z.string().optional()
          .describe("ISO 8601 timestamp — return only messages before this time"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { handle } = await getState();
      try {

        const effectiveLimit = Math.min(args.limit ?? 50, 1000);
        const sinceApple = args.since ? isoToAppleEpoch(args.since) : null;
        const beforeApple = args.before ? isoToAppleEpoch(args.before) : null;

        const rows = handle.db.prepare(GET_MESSAGES_SQL).all(
          args.chat_id,
          sinceApple,
          sinceApple,
          beforeApple,
          beforeApple,
          effectiveLimit + 1
        ) as MessageRow[];

        const hasMore = rows.length > effectiveLimit;
        const returned = hasMore ? rows.slice(0, effectiveLimit) : rows;
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
                    messages: [],
                    chat_id: args.chat_id,
                    total_returned: 0,
                    has_more: false,
                    next_cursor: null,
                    note: "No messages found in this range",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const messages = returned.map((row) => ({
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
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  messages,
                  chat_id: args.chat_id,
                  total_returned: messages.length,
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
              text: `Failed to get messages: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
