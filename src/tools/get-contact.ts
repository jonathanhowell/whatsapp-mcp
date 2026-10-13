import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../config/loader.js";

interface ContactRow {
  contact_id: number;
  full_name: string | null;
  given_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  localized_phone: string | null;
  whatsapp_jid: string | null;
  business_name: string | null;
}

const GET_CONTACT_SQL = `
  SELECT
    Z_PK                    AS contact_id,
    ZFULLNAME               AS full_name,
    ZGIVENNAME              AS given_name,
    ZLASTNAME               AS last_name,
    ZPHONENUMBER            AS phone_number,
    ZLOCALIZEDPHONENUMBER   AS localized_phone,
    ZWHATSAPPID             AS whatsapp_jid,
    ZBUSINESSNAME           AS business_name
  FROM ZWAADDRESSBOOKCONTACT
  WHERE ZFULLNAME LIKE ? ESCAPE '\\'
     OR ZPHONENUMBER LIKE ? ESCAPE '\\'
  ORDER BY ZFULLNAME ASC
  LIMIT 20
`;

export function registerGetContactTool(
  server: McpServer,
  getConfig: () => Config
): void {
  server.registerTool(
    "get_contact",
    {
      description:
        "Look up WhatsApp contacts by name or phone number. Searches the ContactsV2 address book database.",
      inputSchema: {
        query: z.string().min(1).describe("Name or phone number to search for"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const config = getConfig();

        const contactsDbPath = path.join(
          path.dirname(config.dbPath),
          "ContactsV2.sqlite"
        );

        if (!fs.existsSync(contactsDbPath)) {
          return {
            content: [
              {
                type: "text",
                text: `ContactsV2.sqlite not found at ${contactsDbPath} — open WhatsApp Desktop and allow contact sync`,
              },
            ],
            isError: true,
          };
        }

        // Escape special LIKE characters before wrapping in wildcards
        const escaped = args.query
          .replace(/\\/g, "\\\\")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        const likeParam = `%${escaped}%`;

        const contactsDb = new Database(contactsDbPath, {
          readonly: true,
          fileMustExist: true,
        });

        try {
          const rows = contactsDb
            .prepare(GET_CONTACT_SQL)
            .all(likeParam, likeParam) as ContactRow[];

          if (rows.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { contacts: [], total: 0, note: "No contacts matching query" },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    contacts: rows.map((r) => ({
                      contact_id: r.contact_id,
                      full_name: r.full_name,
                      phone_number: r.phone_number,
                      localized_phone: r.localized_phone,
                      whatsapp_jid: r.whatsapp_jid,
                      business_name: r.business_name,
                    })),
                    total: rows.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } finally {
          contactsDb.close();
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Failed to get contact: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
