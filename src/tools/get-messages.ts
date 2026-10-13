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

const GET_MESSAGES_SQL = `
  SELECT${MESSAGE_COLUMNS}
  FROM ZWAMESSAGE m${MESSAGE_JOINS}
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
        "Get messages from a specific WhatsApp chat. Returns messages with sender, timestamp, text (including image/document captions), type, and media metadata, plus type-specific details (call, poll, link, contact, location) and reactions. Supports date range filtering and pagination.",
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
      const { config, handle } = await getState();
      const names = getNameResolver(handle, config.dbPath);
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

        const messages = formatMessages(handle.db, returned, names);

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
