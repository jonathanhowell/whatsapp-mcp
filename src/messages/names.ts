import Database from "better-sqlite3";
import path from "node:path";
import type { DatabaseHandle } from "../db/connection.js";

/**
 * Resolves WhatsApp JIDs (phone-number "…@s.whatsapp.net" or privacy "…@lid")
 * to human-readable names, using, in order of preference:
 *   1. the user's address book (ContactsV2.sqlite: ZLID / ZWHATSAPPID → ZFULLNAME)
 *   2. the sender's push name (ChatStorage ZWAPROFILEPUSHNAME), also via the
 *      lid ↔ phone-number mapping in LID.sqlite (ZWAZACCOUNT)
 *   3. the LID account display name (LID.sqlite ZWAZACCOUNT.ZDISPLAYNAME)
 * ContactsV2/LID are small sibling DBs of ChatStorage.sqlite; they are read
 * once per database handle, read-only, and skipped if unavailable.
 */
export class NameResolver {
  private readonly addressBook = new Map<string, string>();
  private readonly pushNames = new Map<string, string>();
  private readonly lidNames = new Map<string, string>();
  private readonly lidToPn = new Map<string, string>();
  private readonly pnToLid = new Map<string, string>();

  constructor(chatDb: Database.Database, whatsappDir: string | null) {
    for (const r of chatDb
      .prepare("SELECT ZJID AS jid, ZPUSHNAME AS name FROM ZWAPROFILEPUSHNAME WHERE ZJID IS NOT NULL AND ZPUSHNAME <> ''")
      .all() as Array<{ jid: string; name: string }>) {
      this.pushNames.set(r.jid, r.name);
    }
    if (!whatsappDir) return;

    readSibling(path.join(whatsappDir, "ContactsV2.sqlite"), (db) => {
      const rows = db
        .prepare(
          `SELECT ZLID AS lid, ZWHATSAPPID AS pn, COALESCE(NULLIF(ZFULLNAME, ''), NULLIF(ZBUSINESSNAME, '')) AS name
           FROM ZWAADDRESSBOOKCONTACT`
        )
        .all() as Array<{ lid: string | null; pn: string | null; name: string | null }>;
      for (const r of rows) {
        if (!r.name) continue;
        if (r.lid) this.addressBook.set(r.lid, r.name);
        if (r.pn) this.addressBook.set(r.pn, r.name);
        if (r.lid && r.pn) this.link(r.lid, r.pn);
      }
    });

    readSibling(path.join(whatsappDir, "LID.sqlite"), (db) => {
      const rows = db
        .prepare("SELECT ZIDENTIFIER AS lid, ZPHONENUMBER AS phone, ZDISPLAYNAME AS name FROM ZWAZACCOUNT")
        .all() as Array<{ lid: string | null; phone: string | null; name: string | null }>;
      for (const r of rows) {
        if (!r.lid) continue;
        if (r.name) this.lidNames.set(r.lid, r.name);
        if (r.phone) this.link(r.lid, `${r.phone.replace(/^\+/, "")}@s.whatsapp.net`);
      }
    });
  }

  private link(lid: string, pn: string): void {
    if (!this.lidToPn.has(lid)) this.lidToPn.set(lid, pn);
    if (!this.pnToLid.has(pn)) this.pnToLid.set(pn, lid);
  }

  /** Best human-readable name for a JID, or null if none is known. */
  resolve(jid: string | null | undefined): string | null {
    if (!jid) return null;
    const alt = this.lidToPn.get(jid) ?? this.pnToLid.get(jid) ?? null;
    return (
      this.addressBook.get(jid) ??
      (alt ? this.addressBook.get(alt) : undefined) ??
      this.pushNames.get(jid) ??
      (alt ? this.pushNames.get(alt) : undefined) ??
      this.lidNames.get(jid) ??
      (alt ? this.lidNames.get(alt) : undefined) ??
      null
    );
  }
}

function readSibling(file: string, fn: (db: Database.Database) => void): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true, timeout: 0 });
    fn(db);
  } catch {
    // Missing/locked/unexpected schema: fall back to the other sources.
  } finally {
    db?.close();
  }
}

const cache = new WeakMap<DatabaseHandle, NameResolver>();

/** One resolver per database handle (rebuilt after refresh_snapshot). */
export function getNameResolver(handle: DatabaseHandle, chatStoragePath: string): NameResolver {
  let r = cache.get(handle);
  if (!r) {
    r = new NameResolver(handle.db, path.dirname(chatStoragePath));
    cache.set(handle, r);
  }
  return r;
}

