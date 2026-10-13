import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
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
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".vcf": "text/vcard",
};

// ZMESSAGETYPE values that carry a downloadable file: image, video, audio,
// document, GIF, sticker, PSA video, media template, video note.
// (ZWAMEDIAITEM rows also exist for text, calls, links etc. — they hold
// metadata, not files.)
export const FILE_MESSAGE_TYPES = new Set([1, 2, 3, 8, 11, 15, 23, 42, 54]);

export type MediaStatus = "ok" | "no_media" | "not_downloaded" | "missing";

interface MediaRow {
  message_id: number;
  message_type: number;
  media_item_id: number | null;
  media_path: string | null;
  media_url: string | null;
  media_file_size: number | null;
  media_title: string | null;
}

const GET_MEDIA_FILE_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZMESSAGETYPE    AS message_type,
    mi.Z_PK           AS media_item_id,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZMEDIAURL      AS media_url,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title
  FROM ZWAMESSAGE m
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.Z_PK = ?
`;

const LIVE_PATH_SQL = `
  SELECT mi.ZMEDIALOCALPATH AS media_path
  FROM ZWAMESSAGE m JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.Z_PK = ?
`;

const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB (D-05)

const NOT_DOWNLOADED_NOTE =
  "WhatsApp has not downloaded this attachment to this Mac yet. This server is read-only and " +
  "cannot trigger the download (fetching it would mean calling WhatsApp's servers and " +
  "decrypting the media, which this local-only server does not do). Open the chat in WhatsApp " +
  "Desktop and click the attachment to download it, then call get_media_file again.";

/**
 * A snapshot can predate the download. Check the live DB (read-only, single
 * row, fail-fast) for a path recorded since; any error just means "no newer info".
 */
function lookupLivePath(dbPath: string, messageId: number): string | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 0 });
    const row = db.prepare(LIVE_PATH_SQL).get(messageId) as { media_path: string | null } | undefined;
    return row?.media_path ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export interface MediaResolution {
  status: MediaStatus;
  fullPath: string | null;
  size: number | null;
}

/** Classify a message's attachment. Never throws for directories or missing files. */
export function resolveMedia(
  row: MediaRow,
  mediaBase: string,
  livePath: () => string | null
): MediaResolution {
  const hasFile =
    row.media_item_id !== null &&
    FILE_MESSAGE_TYPES.has(row.message_type) &&
    (row.media_path !== null || row.media_url !== null);
  if (!hasFile) return { status: "no_media", fullPath: null, size: null };

  const relPath = row.media_path || livePath();
  if (!relPath) return { status: "not_downloaded", fullPath: null, size: null };

  const fullPath = path.resolve(mediaBase, relPath);
  let st: fs.Stats;
  try {
    st = fs.statSync(fullPath);
  } catch {
    return { status: "missing", fullPath, size: null };
  }
  if (!st.isFile()) return { status: "not_downloaded", fullPath: null, size: null };
  return { status: "ok", fullPath, size: st.size };
}

export function registerGetMediaFileTool(
  server: McpServer,
  getState: () => Promise<{ config: Config; handle: DatabaseHandle }>
): void {
  server.registerTool(
    "get_media_file",
    {
      description:
        "Retrieve a media file (image, voice note, document, video) from a WhatsApp message. Returns base64-encoded content for files under 5 MB, or a file path for larger files. Every response has a `status`: \"ok\" (file returned), \"no_media\" (the message has no attachment), \"not_downloaded\" (WhatsApp hasn't downloaded it to this Mac yet — open the chat in WhatsApp Desktop, then retry), or \"missing\" (it was downloaded but the file is gone).",
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
                text: JSON.stringify(
                  { message_id: args.message_id, status: "not_found", note: "No message with this ID" },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }

        // Media base path — use config.dbPath (live DB location), NOT handle.snapshotPath
        const mediaBase = path.join(path.dirname(config.dbPath), "Message");
        const media = resolveMedia(row, mediaBase, () =>
          handle.mode === "snapshot" ? lookupLivePath(config.dbPath, row.message_id) : null
        );
        const metadata = {
          type: resolveMessageType(row.message_type),
          file_size: row.media_file_size ?? null,
        };

        if (media.status !== "ok") {
          const note =
            media.status === "no_media"
              ? "This message has no media attachment"
              : media.status === "not_downloaded"
                ? NOT_DOWNLOADED_NOTE
                : "The attachment was downloaded but the file is no longer on disk (deleted or offloaded by WhatsApp). Re-download it from the chat in WhatsApp Desktop.";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message_id: row.message_id,
                    status: media.status,
                    found: false,
                    note,
                    metadata,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const fullPath = media.fullPath!;
        const ext = path.extname(fullPath).toLowerCase();

        if (media.size! > SIZE_LIMIT) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    message_id: row.message_id,
                    status: "ok",
                    found: true,
                    inline: false,
                    filename: row.media_title ?? path.basename(fullPath),
                    file_size: media.size,
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
                  status: "ok",
                  found: true,
                  inline: true,
                  filename: row.media_title ?? path.basename(fullPath),
                  file_size: media.size,
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
