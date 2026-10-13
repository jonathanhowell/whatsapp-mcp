import { appleEpochToISO, resolveMessageType } from "../utils/time.js";

/**
 * Columns shared by get_messages, get_messages_since and search_messages.
 * Expects aliases: m = ZWAMESSAGE, mi = ZWAMEDIAITEM (LEFT JOIN),
 * gm = ZWAGROUPMEMBER (LEFT JOIN), sender_ppn = ZWAPROFILEPUSHNAME on gm.
 */
export const MESSAGE_COLUMNS = `
    m.Z_PK            AS message_id,
    m.ZCHATSESSION    AS chat_session_id,
    m.ZTEXT           AS text,
    m.ZMESSAGEDATE    AS message_date,
    m.ZMESSAGETYPE    AS message_type,
    m.ZISFROMME       AS is_from_me,
    COALESCE(NULLIF(gm.ZCONTACTNAME, ''), sender_ppn.ZPUSHNAME, m.ZPUSHNAME) AS sender_name,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title`;

export const MESSAGE_JOINS = `
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
  LEFT JOIN ZWAPROFILEPUSHNAME sender_ppn ON sender_ppn.ZJID = gm.ZMEMBERJID`;

export interface MessageRow {
  message_id: number;
  chat_session_id: number;
  text: string | null;
  message_date: number | null;
  message_type: number;
  is_from_me: number;
  sender_name: string | null;
  media_path: string | null;
  media_file_size: number | null;
  media_title: string | null;
}

// For these types WhatsApp stores the user's caption in ZWAMEDIAITEM.ZTITLE
// (image, video, audio, GIF, sticker, video note); ZTEXT is normally NULL.
export const CAPTION_IN_TITLE_TYPES = new Set([1, 2, 3, 11, 15, 54]);
// For documents ZTEXT is the document's title/filename and ZTITLE the caption.
export const DOCUMENT_TYPE = 8;

/** SQL predicate: message text OR caption matches the LIKE parameter (bind twice). */
export const TEXT_OR_CAPTION_LIKE = `(
    m.ZTEXT LIKE ? ESCAPE '\\'
    OR (m.ZMESSAGETYPE IN (${[...CAPTION_IN_TITLE_TYPES, DOCUMENT_TYPE].join(", ")})
        AND mi.ZTITLE LIKE ? ESCAPE '\\')
  )`;

export interface MediaInfo {
  /** Real filename (documents) or null. Captions are in the message `text`. */
  filename: string | null;
  file_size: number | null;
}

export interface FormattedMessage {
  message_id: number;
  timestamp: string | null;
  type: string;
  is_from_me: boolean;
  sender_name: string | null;
  text: string | null;
  media: MediaInfo | null;
}

function nonEmpty(s: string | null | undefined): string | null {
  return s === null || s === undefined || s === "" ? null : s;
}

/** Split ZTEXT / ZTITLE into message text, caption and filename per type. */
export function textAndMedia(row: MessageRow): { text: string | null; media: MediaInfo | null } {
  const title = nonEmpty(row.media_title);
  let text = nonEmpty(row.text);
  let filename: string | null = null;
  let caption: string | null = null;

  if (CAPTION_IN_TITLE_TYPES.has(row.message_type)) {
    caption = title;
    text = text ?? caption;
  } else if (row.message_type === DOCUMENT_TYPE) {
    filename = text;
    caption = title;
    text = caption;
  } else {
    filename = title;
  }

  const hasMedia = Boolean(row.media_path || row.media_file_size || filename || caption);
  return {
    text,
    media: hasMedia
      ? { filename, file_size: row.media_file_size ?? null }
      : null,
  };
}

export function formatMessage(row: MessageRow): FormattedMessage {
  const { text, media } = textAndMedia(row);
  return {
    message_id: row.message_id,
    timestamp: appleEpochToISO(row.message_date),
    type: resolveMessageType(row.message_type),
    is_from_me: row.is_from_me === 1,
    sender_name: row.sender_name ?? null,
    text,
    media,
  };
}
