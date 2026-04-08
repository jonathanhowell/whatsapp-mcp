import Database from "better-sqlite3";
import fs from "node:fs";
import type { Config } from "../config/loader.js";
import {
  cleanOldSnapshots,
  createSnapshot,
} from "./snapshot.js";
import { validateSchema } from "./validate.js";

export interface DatabaseHandle {
  db: Database.Database;
  mode: "snapshot" | "live";
  snapshotPath: string | null;
}

export async function openDatabase(config: Config): Promise<DatabaseHandle> {
  try {
    if (config.mode === "snapshot") {
      // D-04: clean old snapshots before creating a new one
      cleanOldSnapshots();

      // D-01: create WAL-safe snapshot via .backup()
      const snapshotPath = await createSnapshot(config.dbPath);

      // Open the snapshot — no timeout:0 needed, no lock contention on the copy
      const db = new Database(snapshotPath, {
        readonly: true,
        fileMustExist: true,
      });

      // Validate schema on the snapshot (INFRA-01)
      validateSchema(db);

      process.stderr.write(
        `WhatsApp MCP: Snapshot created at ${snapshotPath}\n`
      );

      return { db, mode: "snapshot", snapshotPath };
    } else {
      // Live mode (opt-in, per INFRA-03)
      if (!fs.existsSync(config.dbPath)) {
        process.stderr.write(
          `WhatsApp database not found at: ${config.dbPath}\n` +
            `Grant Full Disk Access to Claude Desktop in System Settings > ` +
            `Privacy & Security > Full Disk Access, then restart.\n`
        );
        process.exit(1);
      }

      // timeout:0 for fail-fast on SQLITE_BUSY (per Pitfall 4, D-07)
      const db = new Database(config.dbPath, {
        readonly: true,
        fileMustExist: true,
        timeout: 0,
      });

      // Validate schema on the live DB (INFRA-01)
      validateSchema(db);

      process.stderr.write(
        `WhatsApp MCP: Connected to live database (read-only)\n`
      );

      return { db, mode: "live", snapshotPath: null };
    }
  } catch (err: any) {
    if (
      err.code === "SQLITE_BUSY" ||
      (err.message && err.message.includes("SQLITE_BUSY"))
    ) {
      process.stderr.write(
        `Database temporarily locked by WhatsApp. Use snapshot mode (default) to avoid this.\n`
      );
      process.exit(1);
    }
    process.stderr.write(
      `Failed to open WhatsApp database: ${err.message}\n`
    );
    process.exit(1);
  }
}

export async function refreshSnapshot(
  config: Config,
  currentHandle: DatabaseHandle
): Promise<DatabaseHandle> {
  // Close the current connection before creating a new snapshot
  currentHandle.db.close();

  // Create a fresh snapshot (cleanOldSnapshots is not called here — we're refreshing,
  // not starting up; we just overwrite the snapshot file in place)
  const snapshotPath = await createSnapshot(config.dbPath);

  const db = new Database(snapshotPath, {
    readonly: true,
    fileMustExist: true,
  });

  validateSchema(db);

  process.stderr.write(
    `WhatsApp MCP: Snapshot refreshed at ${snapshotPath}\n`
  );

  return { db, mode: "snapshot", snapshotPath };
}
