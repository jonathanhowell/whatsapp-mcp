import Database from "better-sqlite3";
import fs from "node:fs";
import { validateSchema } from "./validate.js";

export interface DatabaseHandle {
  db: Database.Database;
  mode: "snapshot" | "live";
  snapshotPath: string | null;
  /** When the data was captured (snapshot mode) or opened (live mode). */
  createdAt: string;
  /** True when serving a previous snapshot because a fresh one failed. */
  stale: boolean;
}

/** Turn low-level open/copy errors into actionable messages. */
export function explainDbError(err: unknown, dbPath: string): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? String(err);
  if (e?.code === "ERR_DLOPEN_FAILED" || msg.includes("NODE_MODULE_VERSION")) {
    return (
      `better-sqlite3 native module does not match this Node.js version (${process.version}). ` +
      `Run \`npm rebuild better-sqlite3\` in the whatsapp-mcp directory, then restart. (${msg.split("\n")[0]})`
    );
  }
  if (e?.code === "SQLITE_CANTOPEN" || msg.includes("SQLITE_CANTOPEN") || msg.includes("unable to open")) {
    return (
      `Cannot open WhatsApp database at ${dbPath}. Grant Full Disk Access to the app running ` +
      `this server (System Settings > Privacy & Security > Full Disk Access), then restart. (${msg})`
    );
  }
  if (e?.code === "SQLITE_BUSY" || msg.includes("SQLITE_BUSY")) {
    return `Database temporarily locked by WhatsApp. Use snapshot mode (default) to avoid this. (${msg})`;
  }
  return msg;
}

export function openSnapshotFile(snapshotPath: string, stale = false): DatabaseHandle {
  // No timeout needed: nothing else writes to the copy
  const db = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    validateSchema(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return {
    db,
    mode: "snapshot",
    snapshotPath,
    createdAt: fs.statSync(snapshotPath).mtime.toISOString(),
    stale,
  };
}

export function openLiveDatabase(dbPath: string): DatabaseHandle {
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `WhatsApp database not found at: ${dbPath}. Grant Full Disk Access ` +
        `(System Settings > Privacy & Security > Full Disk Access), then restart.`
    );
  }
  // timeout:0 for fail-fast on SQLITE_BUSY (per Pitfall 4, D-07)
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    validateSchema(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return {
    db,
    mode: "live",
    snapshotPath: null,
    createdAt: new Date().toISOString(),
    stale: false,
  };
}
