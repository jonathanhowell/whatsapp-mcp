import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const SNAPSHOT_DIR = path.join(os.tmpdir(), "whatsapp-mcp");
const SNAPSHOT_FILENAME = "snapshot.sqlite";

export function getSnapshotPath(): string {
  return path.join(SNAPSHOT_DIR, SNAPSHOT_FILENAME);
}

export function cleanOldSnapshots(): void {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    return;
  }
  for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
    fs.unlinkSync(path.join(SNAPSHOT_DIR, file));
  }
}

export async function createSnapshot(liveDbPath: string): Promise<string> {
  const snapshotPath = getSnapshotPath();
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let liveDb: Database.Database;
  try {
    liveDb = new Database(liveDbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: 0,
    });
  } catch (err: any) {
    // Handle TCC / access failures per D-05, D-07
    if (
      err.code === "SQLITE_CANTOPEN" ||
      (err.message && err.message.includes("SQLITE_CANTOPEN"))
    ) {
      process.stderr.write(
        `WhatsApp database not found at: ${liveDbPath}\n` +
          `Grant Full Disk Access to Claude Desktop in System Settings > ` +
          `Privacy & Security > Full Disk Access, then restart.\n`
      );
      process.exit(1);
    }
    throw err;
  }

  try {
    await liveDb.backup(snapshotPath);
  } finally {
    liveDb.close();
  }

  return snapshotPath;
}
