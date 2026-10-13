import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { resolveMessageType } from "../utils/time.js";
import type { DatabaseHandle } from "../db/connection.js";
import type { Config } from "../config/loader.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

interface MediaRow {
  message_id: number;
  message_type: number;
  media_path: string | null;
  media_file_size: number | null;
  media_title: string | null;
}

const GET_MEDIA_FILE_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZMESSAGETYPE    AS message_type,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title
  FROM ZWAMESSAGE m
  JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.Z_PK = ?
`;

const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB (D-05)

export function registerGetMediaFileTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "get_media_file",
    {
      description:
        "Retrieve a media file (image, voice note, document, video) from a WhatsApp message. Returns base64-encoded content for files under 5 MB, or a file path for larger files. If the file has been deleted or not downloaded, returns available metadata.",
      inputSchema: {
        message_id: z
          .number()
          .int()
          .describe("The message ID from get_messages or search_messages"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { config, handle } = await getState();
      try {

        const row = handle.db
          .prepare(GET_MEDIA_FILE_SQL)
          .get(args.message_id) as MediaRow | undefined;

        if (!row) {
          return {
            content: [
              {
                type: "text",
                text: `Message ${args.message_id} has no media attachment`,
              },
            ],
            isError: true,
          };
        }

        // Media base path — use config.dbPath (live DB location), NOT handle.snapshotPath
        const mediaBase = path.join(path.dirname(config.dbPath), "Message");
        const fullPath = path.join(mediaBase, row.media_path ?? "");

        if (!fs.existsSync(fullPath)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message_id: row.message_id,
                    found: false,
                    note: "File not found on disk — may have been deleted or not downloaded",
                    metadata: {
                      filename: row.media_title ?? null,
                      file_size: row.media_file_size ?? null,
                      type: resolveMessageType(row.message_type),
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const stat = fs.statSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();

        if (stat.size > SIZE_LIMIT) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message_id: row.message_id,
                    found: true,
                    inline: false,
                    filename: row.media_title ?? path.basename(fullPath),
                    file_size: stat.size,
                    content_type: MIME_TYPES[ext] ?? "application/octet-stream",
                    file_path: fullPath,
                    note: "File exceeds 5 MB — use file_path to access directly",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const bytes = fs.readFileSync(fullPath);
        const base64 = bytes.toString("base64");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message_id: row.message_id,
                  found: true,
                  inline: true,
                  filename: row.media_title ?? path.basename(fullPath),
                  file_size: stat.size,
                  content_type: MIME_TYPES[ext] ?? "application/octet-stream",
                  data: base64,
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
              text: `Failed to get media file: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
