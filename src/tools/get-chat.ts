import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { appleEpochToISO } from "../utils/time.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";
import { getNameResolver } from "../messages/names.js";

interface ChatRow {
  chat_id: number;
  jid: string | null;
  partner_name: string | null;
  push_name: string | null;
  session_type: number;
  unread_count: number;
  last_message_date: number | null;
  last_message_text: string | null;
  owner_jid: string | null;
  creator_jid: string | null;
  created_at: number | null;
}

interface MemberRow {
  jid: string;
  is_admin: number;
  display_name: string | null;
}

const SESSION_TYPE_MAP: Record<number, string> = {
  0: "individual",
  1: "group",
  2: "broadcast",
  3: "status",
};

const GET_CHAT_SQL = `
  SELECT
    cs.Z_PK             AS chat_id,
    cs.ZCONTACTJID      AS jid,
    cs.ZPARTNERNAME     AS partner_name,
    ppn.ZPUSHNAME       AS push_name,
    cs.ZSESSIONTYPE     AS session_type,
    cs.ZUNREADCOUNT     AS unread_count,
    cs.ZLASTMESSAGEDATE AS last_message_date,
    cs.ZLASTMESSAGETEXT AS last_message_text,
    gi.ZOWNERJID        AS owner_jid,
    gi.ZCREATORJID      AS creator_jid,
    gi.ZCREATIONDATE    AS created_at
  FROM ZWACHATSESSION cs
  LEFT JOIN ZWAPROFILEPUSHNAME ppn ON ppn.ZJID = cs.ZCONTACTJID
  LEFT JOIN ZWAGROUPINFO gi ON gi.ZCHATSESSION = cs.Z_PK
  WHERE cs.Z_PK = ?
`;

const GET_GROUP_MEMBERS_SQL = `
  SELECT
    gm.ZMEMBERJID    AS jid,
    gm.ZISADMIN      AS is_admin,
    NULLIF(gm.ZCONTACTNAME, '') AS display_name
  FROM ZWAGROUPMEMBER gm
  WHERE gm.ZCHATSESSION = ?
    AND gm.ZISACTIVE = 1
  ORDER BY gm.ZISADMIN DESC, gm.ZMEMBERJID ASC
`;

export function registerGetChatTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "get_chat",
    {
      description:
        "Get detailed information about a WhatsApp chat. For group chats, includes group members with JID and display name (resolved from your address book, push names and WhatsApp's @lid mapping; null if unknown).",
      inputSchema: {
        chat_id: z.number().int().describe("The chat ID from list_chats"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { config, handle } = await getState();
      try {

        const chatRow = handle.db
          .prepare(GET_CHAT_SQL)
          .get(args.chat_id) as ChatRow | undefined;

        if (!chatRow) {
          return {
            content: [
              {
                type: "text",
                text: `Chat not found for ID: ${args.chat_id}`,
              },
            ],
            isError: true,
          };
        }

        let groupInfo: object | null = null;

        if (chatRow.session_type === 1) {
          // Group chat — query members
          const names = getNameResolver(handle, config.dbPath);
          const members = handle.db
            .prepare(GET_GROUP_MEMBERS_SQL)
            .all(args.chat_id) as MemberRow[];

          groupInfo = {
            owner_jid: chatRow.owner_jid,
            creator_jid: chatRow.creator_jid,
            created_at: appleEpochToISO(chatRow.created_at),
            member_count: members.length,
            members: members.map((m) => ({
              jid: m.jid,
              is_admin: m.is_admin === 1,
              display_name: m.display_name ?? names.resolve(m.jid),
            })),
          };
        }

        const result = {
          chat_id: chatRow.chat_id,
          jid: chatRow.jid,
          name:
            chatRow.push_name ??
            chatRow.partner_name ??
            chatRow.jid ??
            "Unknown",
          type:
            SESSION_TYPE_MAP[chatRow.session_type] ??
            `unknown(${chatRow.session_type})`,
          unread_count: chatRow.unread_count,
          last_message_at: appleEpochToISO(chatRow.last_message_date),
          last_message_preview: chatRow.last_message_text,
          group_info: groupInfo,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to get chat: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
