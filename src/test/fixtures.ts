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
      ZPUSHNAME TEXT, ZSTANZAID TEXT);
  `);
  setup?.(db);
  db.close();
  return p;
}
