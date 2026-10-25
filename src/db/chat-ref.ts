import type Database from "better-sqlite3";

export interface ChatRef {
  chat_id: number;
  /** null only when chat_id names no chat. */
  chat_jid: string | null;
}

const CHAT_JID_BY_ID_SQL = `
  SELECT cs.ZCONTACTJID AS chat_jid
  FROM ZWACHATSESSION cs
  WHERE cs.Z_PK = ?
`;

// ZCONTACTJID was unique across all 727 chats in the audited DB (none NULL).
// If WhatsApp ever keeps two sessions for one JID, prefer the active one.
const CHAT_ID_BY_JID_SQL = `
  SELECT cs.Z_PK AS chat_id
  FROM ZWACHATSESSION cs
  WHERE cs.ZCONTACTJID = ?
  ORDER BY cs.ZLASTMESSAGEDATE DESC
  LIMIT 1
`;

/**
 * Resolve a tool's `chat_id` / `chat_jid` input (exactly one required) to
 * both keys. An unknown chat_id is returned with chat_jid null so callers keep
 * their existing not-found behaviour; an unknown chat_jid throws.
 */
export function resolveChatRef(
  db: Database.Database,
  args: { chat_id?: number; chat_jid?: string }
): ChatRef {
  if ((args.chat_id === undefined) === (args.chat_jid === undefined)) {
    throw new Error("Provide exactly one of chat_id or chat_jid");
  }
  if (args.chat_jid !== undefined) {
    const row = db.prepare(CHAT_ID_BY_JID_SQL).get(args.chat_jid) as { chat_id: number } | undefined;
    if (!row) throw new Error(`No chat with JID: ${args.chat_jid}`);
    return { chat_id: row.chat_id, chat_jid: args.chat_jid };
  }
  const row = db.prepare(CHAT_JID_BY_ID_SQL).get(args.chat_id) as { chat_jid: string | null } | undefined;
  return { chat_id: args.chat_id!, chat_jid: row?.chat_jid ?? null };
}
