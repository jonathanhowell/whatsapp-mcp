import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
  text: string | null;
}

const GET_MEDIA_FILE_SQL = `
  SELECT
    m.Z_PK            AS message_id,
    m.ZMESSAGETYPE    AS message_type,
    mi.Z_PK           AS media_item_id,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZMEDIAURL      AS media_url,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title,
    m.ZTEXT           AS text
  FROM ZWAMESSAGE m
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.Z_PK = ?
`;

const LIVE_PATH_SQL = `
  SELECT mi.ZMEDIALOCALPATH AS media_path
  FROM ZWAMESSAGE m JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  WHERE m.Z_PK = ?
`;

const SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB cap for inline: true (D-05)

export const MEDIA_EXPORT_DIR = path.join(os.tmpdir(), "whatsapp-mcp", "media");
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Original filename where WhatsApp has one: for documents (type 8) ZTEXT is
 * the document title. Images/videos have no original name, so use the local
 * file's name. (ZTITLE is the caption, never a filename.)
 */
export function mediaFilename(row: Pick<MediaRow, "message_type" | "text">, fullPath: string): string {
  const ext = path.extname(fullPath);
  if (row.message_type === 8 && row.text) {
    return path.extname(row.text).toLowerCase() === ext.toLowerCase() ? row.text : `${row.text}${ext}`;
  }
  return path.basename(fullPath);
}

/**
 * Copy the attachment to a stable temp path the caller can read (it may not
 * have Full Disk Access to WhatsApp's container). Exports older than a day
 * are pruned on the way.
 */
export function exportMedia(
  messageId: number,
  fullPath: string,
  filename: string,
  dir: string = MEDIA_EXPORT_DIR
): string {
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const f of fs.readdirSync(dir)) {
    try {
      const p = path.join(dir, f);
      if (now - fs.statSync(p).mtimeMs > EXPORT_TTL_MS) fs.unlinkSync(p);
    } catch {
      // raced with another instance
    }
  }
  const safe = filename.replace(/[\/\0]/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
  const dest = path.join(dir, `${messageId}-${safe}`);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.copyFileSync(fullPath, tmp);
  fs.renameSync(tmp, dest);
  return dest;
}

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
        "Retrieve a media file from a WhatsApp message — images (e.g. photographed letters), PDFs and other documents, voice notes, videos, GIFs and stickers are all retrievable. By default the file is copied to a local temp path and the response is {status, path, mime_type, byte_size, filename}; read the file at `path` (images and PDFs can be viewed directly). Pass inline: true to get base64 content instead (files up to 5 MB). Every response has a `status`: \"ok\" (file returned), \"no_media\" (the message has no attachment), \"not_downloaded\" (WhatsApp hasn't downloaded it to this Mac yet — open the chat in WhatsApp Desktop, then retry), or \"missing\" (it was downloaded but the file is gone).",
      inputSchema: {
        message_id: z
          .number()
          .int()
          .describe("The message ID from get_messages or search_messages"),
        inline: z
          .boolean()
          .optional()
          .describe(
            "Return the bytes inline as base64 (files up to 5 MB only). Default false: the file is written to a temp path and the path is returned."
          ),
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
        const filename = mediaFilename(row, fullPath);
        const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
        const common = {
          message_id: row.message_id,
          status: "ok" as const,
          found: true,
          filename,
          mime_type: mimeType,
          byte_size: media.size,
          // Pre-1.1 names, kept for compatibility
          content_type: mimeType,
          file_size: media.size,
        };

        if (args.inline && media.size! <= SIZE_LIMIT) {
          const base64 = fs.readFileSync(fullPath).toString("base64");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ...common, inline: true, data: base64 }, null, 2),
              },
            ],
          };
        }

        const exported = exportMedia(row.message_id, fullPath, filename);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...common,
                  inline: false,
                  path: exported,
                  file_path: exported,
                  source_path: fullPath,
                  ...(args.inline
                    ? { note: "File exceeds 5 MB, so it was not inlined — read it from `path`" }
                    : {}),
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
