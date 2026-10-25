import type Database from "better-sqlite3";
import { appleEpochToISO, resolveMessageType } from "../utils/time.js";
import { ProtoMessage } from "../utils/protobuf.js";
import type { NameResolver } from "./names.js";

/**
 * Columns shared by get_messages, get_messages_since and search_messages.
 * Expects aliases: m = ZWAMESSAGE, mi = ZWAMEDIAITEM (LEFT JOIN),
 * gm = ZWAGROUPMEMBER (LEFT JOIN), inf = ZWAMESSAGEINFO (LEFT JOIN),
 * mcs = the message's ZWACHATSESSION.
 *
 * Stable keys: Z_PK (message_id / chat_id) is a Core Data row number that
 * WhatsApp re-assigns. ZSTANZAID is WhatsApp's own message ID and
 * ZCONTACTJID the chat's JID. ZSTANZAID is unique only per chat (call
 * events reuse the call ID across chats), so the stable message key is
 * chat JID + stanza ID. See README "Stable keys".
 *
 * Sender: in groups the member JID (ZWAGROUPMEMBER.ZMEMBERJID); in 1:1 chats
 * the chat partner (ZFROMJID is the group JID in groups, so it is only used
 * for 1:1). ZWAMESSAGE.ZPUSHNAME is deliberately NOT used: it is a base64
 * protobuf blob (e.g. "COiOqdUGIAA="), never a name.
 */
export const MESSAGE_COLUMNS = `
    m.Z_PK            AS message_id,
    m.ZSTANZAID       AS stanza_id,
    m.ZCHATSESSION    AS chat_session_id,
    mcs.ZCONTACTJID   AS chat_jid,
    m.ZTEXT           AS text,
    m.ZMESSAGEDATE    AS message_date,
    m.ZMESSAGETYPE    AS message_type,
    m.ZGROUPEVENTTYPE AS event_code,
    m.ZISFROMME       AS is_from_me,
    CASE WHEN m.ZISFROMME = 1 THEN NULL
         ELSE COALESCE(gm.ZMEMBERJID,
                       CASE WHEN mcs.ZSESSIONTYPE = 0 THEN COALESCE(mcs.ZCONTACTJID, m.ZFROMJID) END)
    END               AS sender_jid,
    NULLIF(gm.ZCONTACTNAME, '') AS group_contact_name,
    mcs.ZSESSIONTYPE  AS session_type,
    NULLIF(mcs.ZPARTNERNAME, '') AS partner_name,
    mi.ZMEDIALOCALPATH AS media_path,
    mi.ZFILESIZE      AS media_file_size,
    mi.ZTITLE         AS media_title,
    mi.ZMEDIAURL      AS media_url,
    mi.ZVCARDNAME     AS vcard_name,
    mi.ZVCARDSTRING   AS vcard_string,
    mi.ZLATITUDE      AS latitude,
    mi.ZLONGITUDE     AS longitude,
    mi.ZMOVIEDURATION AS media_duration,
    mi.ZMETADATA      AS metadata,
    inf.ZRECEIPTINFO  AS receipt_info`;

export const MESSAGE_JOINS = `
  LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
  LEFT JOIN ZWAMESSAGEINFO inf ON inf.Z_PK = m.ZMESSAGEINFO
  LEFT JOIN ZWAGROUPMEMBER gm ON gm.Z_PK = m.ZGROUPMEMBER
  LEFT JOIN ZWACHATSESSION mcs ON mcs.Z_PK = m.ZCHATSESSION`;

export interface MessageRow {
  message_id: number;
  stanza_id: string | null;
  chat_session_id: number;
  chat_jid: string | null;
  text: string | null;
  message_date: number | null;
  message_type: number;
  event_code?: number | null;
  is_from_me: number;
  sender_jid: string | null;
  group_contact_name: string | null;
  session_type: number | null;
  partner_name: string | null;
  media_path: string | null;
  media_file_size: number | null;
  media_title: string | null;
  media_url?: string | null;
  vcard_name?: string | null;
  vcard_string?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  media_duration?: number | null;
  metadata?: Buffer | null;
  receipt_info?: Buffer | null;
}

// For these types WhatsApp stores the user's caption in ZWAMEDIAITEM.ZTITLE
// (image, video, audio, GIF, sticker, video note); ZTEXT is normally NULL.
export const CAPTION_IN_TITLE_TYPES = new Set([1, 2, 3, 11, 15, 54]);
// For documents ZTEXT is the document's title/filename and ZTITLE the caption.
export const DOCUMENT_TYPE = 8;
const FILE_TYPES = new Set([...CAPTION_IN_TITLE_TYPES, DOCUMENT_TYPE, 23, 42]);

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

export interface Reaction {
  emoji: string;
  /** Reactions by the account owner carry no reactor JID. */
  from_me: boolean;
  sender_jid: string | null;
  sender_name?: string | null;
  timestamp: string | null;
}

export interface CallInfo {
  direction: "incoming" | "outgoing";
  video: boolean;
  duration_seconds: number;
  outcome: string;
  missed: boolean;
}

export interface PollInfo {
  question: string;
  options: Array<{ name: string; votes: number }>;
  max_selections: number | null;
}

export interface FormattedMessage {
  message_id: number;
  /** WhatsApp's message ID (ZSTANZAID); stable, unique within a chat. */
  stanza_id: string | null;
  timestamp: string | null;
  type: string;
  is_from_me: boolean;
  /** Human-readable sender, or null if unresolved (and for own messages). */
  sender_name: string | null;
  /** Raw sender JID (…@s.whatsapp.net or …@lid); null for own messages. */
  sender_jid: string | null;
  text: string | null;
  media: MediaInfo | null;
  link?: { url: string | null; title: string | null };
  contact?: { name: string | null; vcard: string | null };
  location?: { latitude: number; longitude: number };
  call?: CallInfo;
  poll?: PollInfo;
  reactions?: Reaction[];
  event_code?: number;
  /** The message this one replies to, or null. */
  quoted: QuotedMessage | null;
}

export interface QuotedMessage {
  /** null when the quoted message is not in the database (deleted / never synced). */
  message_id: number | null;
  /** Always known, even when the original is gone. */
  stanza_id: string;
  /** Chat holding the quoted message; another chat for a private reply to a group message. */
  chat_jid: string | null;
  text: string | null;
  is_from_me: boolean | null;
  sender_name: string | null;
  sender_jid: string | null;
}

function nonEmpty(s: string | null | undefined): string | null {
  return s === null || s === undefined || s === "" ? null : s;
}

/** Split ZTEXT / ZTITLE into message text, caption and filename per type. */
export function textAndMedia(row: MessageRow): { text: string | null; media: MediaInfo | null } {
  const title = nonEmpty(row.media_title);
  let text = nonEmpty(row.text);
  let filename: string | null = null;

  if (CAPTION_IN_TITLE_TYPES.has(row.message_type)) {
    text = text ?? title;
  } else if (row.message_type === DOCUMENT_TYPE) {
    filename = text;
    text = title;
  }

  const hasMedia =
    FILE_TYPES.has(row.message_type) &&
    Boolean(row.media_path || row.media_file_size || row.media_url || filename);
  return {
    text,
    media: hasMedia ? { filename, file_size: row.media_file_size ?? null } : null,
  };
}

// ZMETADATA field 87.1 for calls: 1 = video flag, 2 = outcome, 3 = duration
// (s). Outcome codes cross-checked against CallHistory.sqlite: 0 = answered,
// 1 = missed / not answered; 3 and 4 are less common (rejected; answered on
// another device), 6 = failed.
const CALL_OUTCOMES: Record<number, string> = {
  0: "answered",
  1: "missed",
  3: "rejected",
  4: "answered_elsewhere",
  6: "failed",
};

export function decodeCall(row: MessageRow): CallInfo | null {
  const call = ProtoMessage.decode(row.metadata).path(87, 1);
  const outcomeCode = call.int(2) ?? 0;
  const duration = call.int(3) ?? 0;
  const incoming = row.is_from_me !== 1;
  let outcome = CALL_OUTCOMES[outcomeCode] ?? `unknown(${outcomeCode})`;
  if (outcome === "missed" && !incoming) outcome = "not_answered";
  return {
    direction: incoming ? "incoming" : "outgoing",
    video: call.int(1) === 1,
    duration_seconds: duration,
    outcome,
    missed: incoming && duration === 0 && outcomeCode !== 0 && outcomeCode !== 4,
  };
}

function describeCall(c: CallInfo): string {
  const kind = c.video ? "video" : "voice";
  if (c.missed) return `Missed ${kind} call`;
  const dir = c.direction === "incoming" ? "Incoming" : "Outgoing";
  if (c.duration_seconds > 0) {
    const m = Math.floor(c.duration_seconds / 60);
    const s = c.duration_seconds % 60;
    return `${dir} ${kind} call (${m > 0 ? `${m}m ` : ""}${s}s)`;
  }
  return `${dir} ${kind} call (${c.outcome.replace("_", " ")})`;
}

// ZRECEIPTINFO field 8: 2 = question, 3 (repeated) = option {1: name},
// 4 = selectable count, 5 (repeated) = vote {1: option indices, 4: voter}.
export function decodePoll(row: MessageRow): PollInfo | null {
  const poll = ProtoMessage.decode(row.receipt_info).msg(8);
  const question = poll.str(2);
  if (question === null) return null;
  const options = poll.msgs(3).map((o) => ({ name: o.str(1) ?? "", votes: 0 }));
  for (const vote of poll.msgs(5)) {
    for (const idx of vote.ints(1)) if (options[idx]) options[idx].votes++;
  }
  return { question, options, max_selections: poll.int(4) };
}

// ZRECEIPTINFO field 7 holds reactions *to* this message:
// 1 (repeated) = {1: reaction id, 2: reactor JID, 3: emoji, 4: ms timestamp}.
// The JID is absent on our own reactions (747 of 748 such entries in the
// audited DB were on inbound messages).
export function decodeReactions(receiptInfo: Buffer | null | undefined): Reaction[] {
  const out: Reaction[] = [];
  for (const container of ProtoMessage.decode(receiptInfo).msgs(7)) {
    for (const r of container.msgs(1)) {
      const emoji = r.str(3);
      if (!emoji) continue; // empty emoji = reaction removed
      const ms = r.int(4);
      const jid = r.str(2);
      out.push({
        emoji,
        from_me: jid === null,
        sender_jid: jid,
        timestamp: ms ? new Date(ms).toISOString() : null,
      });
    }
  }
  return out;
}

/** Body text of business template (19, 23) and interactive (30) messages. */
function decodeBusinessText(row: MessageRow): string | null {
  const meta = ProtoMessage.decode(row.metadata);
  if (row.message_type === 30) {
    const msg = meta.path(43, 1);
    const body = msg.str(2);
    const options = msg.msgs(5).flatMap((s) => s.msgs(2).map((o) => o.str(1)));
    const parts = [body, ...options.filter(Boolean).map((o) => `- ${o}`)];
    return nonEmpty(parts.filter(Boolean).join("\n"));
  }
  const tpl = meta.path(24, 1);
  const parts = [tpl.str(2), tpl.str(6), tpl.str(7)].filter((p): p is string => Boolean(p));
  return nonEmpty(parts.join("\n\n"));
}

/** Sender name: group contact name, then resolver; 1:1 inbound falls back to the chat's name. */
export function resolveSenderName(row: MessageRow, names?: NameResolver): string | null {
  if (row.is_from_me === 1) return null;
  return (
    row.group_contact_name ??
    names?.resolve(row.sender_jid) ??
    (row.session_type === 0 ? row.partner_name : null) ??
    null
  );
}

export function formatMessage(row: MessageRow, names?: NameResolver): FormattedMessage {
  let { text, media } = textAndMedia(row);
  const out: FormattedMessage = {
    message_id: row.message_id,
    stanza_id: row.stanza_id ?? null,
    timestamp: appleEpochToISO(row.message_date),
    type: resolveMessageType(row.message_type),
    is_from_me: row.is_from_me === 1,
    sender_name: resolveSenderName(row, names),
    sender_jid: row.is_from_me === 1 ? null : row.sender_jid ?? null,
    text,
    media,
    quoted: null,
  };

  switch (row.message_type) {
    case 4:
      out.contact = { name: nonEmpty(row.vcard_name), vcard: nonEmpty(row.vcard_string) };
      out.text = text ?? out.contact.name;
      break;
    case 5:
      if (row.latitude != null && row.longitude != null) {
        out.location = { latitude: row.latitude, longitude: row.longitude };
      }
      break;
    case 7:
      out.link = { url: nonEmpty(row.media_url), title: nonEmpty(row.media_title) };
      break;
    case 10:
      out.event_code = row.event_code ?? undefined;
      break;
    case 19:
    case 23:
    case 30:
      out.text = text ?? decodeBusinessText(row);
      break;
    case 46: {
      const poll = decodePoll(row);
      if (poll) {
        out.poll = poll;
        out.text = [
          `Poll: ${poll.question}`,
          ...poll.options.map((o) => `- ${o.name} (${o.votes} vote${o.votes === 1 ? "" : "s"})`),
        ].join("\n");
      }
      break;
    }
    case 59: {
      const call = decodeCall(row);
      if (call) {
        out.call = call;
        out.text = describeCall(call);
      }
      break;
    }
  }

  const reactions = decodeReactions(row.receipt_info);
  if (reactions.length > 0) {
    if (names) for (const r of reactions) r.sender_name = r.from_me ? null : names.resolve(r.sender_jid);
    out.reactions = reactions;
  }
  return out;
}

// Replies: ZWAMEDIAITEM.ZMETADATA field 5 = quoted message's ZSTANZAID,
// 6 = quoted sender JID, 7 = the quoted message's chat JID when it is in
// another chat, 19.1 = snapshot of the quoted text. Field 7 was set on 40 of
// 3,258 replies in the audited DB, all in 1:1 chats and all pointing at a
// group ("reply privately"); 32 of those originals were found in that group
// and none in the replying chat. (ZPARENTMESSAGE
// is NOT the reply link: in the audited DB it is set on only 7 rows, mostly
// group events pointing at e.g. a pinned message.)
export function decodeQuote(metadata: Buffer | null | undefined) {
  const meta = ProtoMessage.decode(metadata);
  const stanzaId = meta.str(5);
  if (!stanzaId) return null;
  return { stanzaId, chatJid: meta.str(7), senderJid: meta.str(6), text: meta.path(19).str(1) };
}

const QUOTED_SQL = (n: number) => `
  SELECT${MESSAGE_COLUMNS}
  FROM ZWAMESSAGE m${MESSAGE_JOINS}
  WHERE m.ZSTANZAID IN (${Array(n).fill("?").join(", ")})`;

/**
 * Format rows and attach `quoted` context. Quoted messages are looked up in
 * one batched query by stanza ID (indexed), matched within the same chat, or
 * within the chat named by ZMETADATA field 7 for private replies.
 */
export function formatMessages(
  db: Database.Database,
  rows: MessageRow[],
  names?: NameResolver
): FormattedMessage[] {
  const out = rows.map((r) => formatMessage(r, names));
  const quotes = rows.map((r) => decodeQuote(r.metadata));
  const ids = [...new Set(quotes.flatMap((q) => (q ? [q.stanzaId] : [])))];
  const targets = new Map<string, MessageRow>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const t of db.prepare(QUOTED_SQL(chunk.length)).all(...chunk) as MessageRow[]) {
      targets.set(`id:${t.chat_session_id}:${t.stanza_id}`, t);
      if (t.chat_jid) targets.set(`jid:${t.chat_jid}:${t.stanza_id}`, t);
    }
  }
  quotes.forEach((q, i) => {
    if (!q) return;
    const target = q.chatJid
      ? targets.get(`jid:${q.chatJid}:${q.stanzaId}`)
      : targets.get(`id:${rows[i].chat_session_id}:${q.stanzaId}`);
    const chatJid = q.chatJid ?? rows[i].chat_jid ?? null;
    if (target) {
      const f = formatMessage(target, names);
      out[i].quoted = {
        message_id: f.message_id,
        stanza_id: q.stanzaId,
        chat_jid: chatJid,
        text: f.text ?? q.text,
        is_from_me: f.is_from_me,
        sender_name: f.sender_name,
        sender_jid: f.sender_jid,
      };
    } else {
      out[i].quoted = {
        message_id: null,
        stanza_id: q.stanzaId,
        chat_jid: chatJid,
        text: q.text,
        is_from_me: null,
        sender_name: names?.resolve(q.senderJid) ?? null,
        sender_jid: q.senderJid,
      };
    }
  });
  return out;
}
