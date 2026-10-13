import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appleEpochToISO, isoToAppleEpoch } from "../utils/time.js";
import {
  MESSAGE_COLUMNS,
  MESSAGE_JOINS,
  TEXT_OR_CAPTION_LIKE,
  formatMessage,
  type MessageRow,
} from "../messages/format.js";
import { getNameResolver } from "../messages/names.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

interface SearchRow extends MessageRow {
  chat_name: string | null;
  chat_jid: string | null;
  chat_push_name: string | null;
}

const SEARCH_MESSAGES_SQL = `
  SELECT${MESSAGE_COLUMNS},
    cs.ZPARTNERNAME   AS chat_name,
    cs.ZCONTACTJID    AS chat_jid,
    ppn.ZPUSHNAME     AS chat_push_name
  FROM ZWAMESSAGE m
  JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID${MESSAGE_JOINS}
  WHERE ${TEXT_OR_CAPTION_LIKE}
  ORDER BY m.ZMESSAGEDATE DESC
  LIMIT ?
`;

const SEARCH_MESSAGES_WITH_CURSOR_SQL = `
  SELECT${MESSAGE_COLUMNS},
    cs.ZPARTNERNAME   AS chat_name,
    cs.ZCONTACTJID    AS chat_jid,
    ppn.ZPUSHNAME     AS chat_push_name
  FROM ZWAMESSAGE m
  JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID${MESSAGE_JOINS}
  WHERE ${TEXT_OR_CAPTION_LIKE}
    AND m.ZMESSAGEDATE < ?
  ORDER BY m.ZMESSAGEDATE DESC
  LIMIT ?
`;

export function registerSearchMessagesTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "search_messages",
    {
      description:
        "Search WhatsApp messages across all chats by keyword. Matches message text and the captions of images, videos and documents. Returns matching messages grouped by chat. Case-insensitive.",
      inputSchema: {
        query: z.string().min(1).describe("Search keyword or phrase"),
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from previous search result (ISO 8601 timestamp)"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { config, handle } = await getState();
      const names = getNameResolver(handle, config.dbPath);
      try {

        // Escape special LIKE characters before wrapping in wildcards
        const escaped = args.query
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const likePattern = `%${escaped}%`;

        const CAP = 1000;

        let rows: SearchRow[];
        if (args.cursor) {
          const cursorApple = isoToAppleEpoch(args.cursor);
          rows = handle.db
            .prepare(SEARCH_MESSAGES_WITH_CURSOR_SQL)
            .all(likePattern, likePattern, cursorApple, CAP + 1) as SearchRow[];
        } else {
          rows = handle.db
            .prepare(SEARCH_MESSAGES_SQL)
            .all(likePattern, likePattern, CAP + 1) as SearchRow[];
        }

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
                    note: "No messages matching query",
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
          chatMap.get(row.chat_session_id)!.messages.push(formatMessage(row, names));
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
              text: `Failed to search messages: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
