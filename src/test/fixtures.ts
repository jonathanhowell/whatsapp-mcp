import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function makeTmpDir(prefix = "wa-mcp-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A pid that is guaranteed not to be running. */
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
  return Number(r.stdout.toString());
}

/**
 * Minimal ChatStorage-shaped DB (WAL mode, like WhatsApp's). `setup` can add
 * rows; tables mirror the columns the tools query.
 */
export function makeFakeChatStorage(dir: string, setup?: (db: Database.Database) => void): string {
  const p = path.join(dir, "ChatStorage.sqlite");
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT,
      ZSESSIONTYPE INTEGER, ZUNREADCOUNT INTEGER, ZLASTMESSAGEDATE REAL, ZLASTMESSAGETEXT TEXT);
    CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMESSAGE INTEGER, ZMEDIALOCALPATH TEXT,
      ZFILESIZE INTEGER, ZTITLE TEXT, ZMEDIAURL TEXT, ZVCARDSTRING TEXT, ZVCARDNAME TEXT,
      ZMOVIEDURATION INTEGER, ZLATITUDE REAL, ZLONGITUDE REAL, ZMETADATA BLOB);
    CREATE TABLE ZWAPROFILEPUSHNAME (Z_PK INTEGER PRIMARY KEY, ZJID TEXT, ZPUSHNAME TEXT);
    CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZMEMBERJID TEXT,
      ZCONTACTNAME TEXT, ZISADMIN INTEGER, ZISACTIVE INTEGER);
    CREATE TABLE ZWAGROUPINFO (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZOWNERJID TEXT,
      ZCREATORJID TEXT, ZCREATIONDATE REAL);
    CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER,
      ZMEDIAITEM INTEGER, ZPARENTMESSAGE INTEGER, ZMESSAGETYPE INTEGER, ZGROUPEVENTTYPE INTEGER,
      ZISFROMME INTEGER, ZMESSAGESTATUS INTEGER, ZFLAGS INTEGER, ZSTARRED INTEGER,
      ZMESSAGEDATE REAL, ZSENTDATE REAL, ZTEXT TEXT, ZFROMJID TEXT, ZTOJID TEXT,
      ZPUSHNAME TEXT, ZSTANZAID TEXT, ZMESSAGEINFO INTEGER, ZSORT INTEGER);
    CREATE TABLE ZWAMESSAGEINFO (Z_PK INTEGER PRIMARY KEY, ZMESSAGE INTEGER, ZRECEIPTINFO BLOB);
  `);
  setup?.(db);
  db.close();
  return p;
}

/** Tiny protobuf encoder for building ZMETADATA / ZRECEIPTINFO fixtures. */
export type PbValue = number | string | Buffer | PbField[];
export type PbField = [number, PbValue];

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

export function pb(fields: PbField[]): Buffer {
  const parts: Buffer[] = [];
  for (const [f, v] of fields) {
    if (typeof v === "number") {
      parts.push(Buffer.from([...varint(f * 8), ...varint(v)]));
    } else {
      const bytes = typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.isBuffer(v) ? v : pb(v);
      parts.push(Buffer.from([...varint(f * 8 + 2), ...varint(bytes.length)]), bytes);
    }
  }
  return Buffer.concat(parts);
}
