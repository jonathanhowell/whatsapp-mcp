// Runs in a worker thread so the main thread (and the MCP transport) stays
// responsive, and so a wedged copy can be killed with worker.terminate().
// Keep this file self-contained: it is loaded directly as a worker entry point.
import Database from "better-sqlite3";
import fs from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

export interface SnapshotWorkerInput {
  liveDbPath: string;
  tmpPath: string;
  maxRestarts: number;
}

export interface SnapshotWorkerOutput {
  ok: boolean;
  method?: "backup" | "vacuum_into";
  restarts?: number;
  error?: string;
  backupError?: string;
}

function removeIfExists(p: string): void {
  for (const f of [p, `${p}-wal`, `${p}-shm`, `${p}-journal`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // not present
    }
  }
}

// Online backup API. better-sqlite3 defaults to 100 pages per step and yields
// between steps, which releases the read transaction: any write by WhatsApp in
// that gap restarts the copy from page 0, and under sustained writes it never
// finishes. Asking for every page in one step copies the whole DB inside a
// single read transaction, so it cannot be restarted. The restart counter is a
// guard in case the copy still ends up being stepped.
async function viaBackup(
  live: Database.Database,
  tmpPath: string,
  maxRestarts: number
): Promise<number> {
  let restarts = 0;
  let lastRemaining = Infinity;
  await live.backup(tmpPath, {
    progress({ totalPages, remainingPages }) {
      if (remainingPages > lastRemaining) restarts++;
      lastRemaining = remainingPages;
      if (restarts > maxRestarts) {
        throw new Error(
          `backup restarted ${restarts} times (source DB is being written continuously)`
        );
      }
      return Math.max(totalPages, 1) * 2;
    },
  });
  return restarts;
}

async function run(input: SnapshotWorkerInput): Promise<SnapshotWorkerOutput> {
  removeIfExists(input.tmpPath);

  const live = new Database(input.liveDbPath, {
    readonly: true,
    fileMustExist: true,
    timeout: 0,
  });

  let result: SnapshotWorkerOutput;
  try {
    try {
      const restarts = await viaBackup(live, input.tmpPath, input.maxRestarts);
      result = { ok: true, method: "backup", restarts };
    } catch (err: unknown) {
      const backupError = err instanceof Error ? err.message : String(err);
      removeIfExists(input.tmpPath);
      // Fallback: VACUUM INTO reads the source in one read transaction and
      // works on a read-only connection.
      live.prepare("VACUUM INTO ?").run(input.tmpPath);
      result = { ok: true, method: "vacuum_into", backupError };
    }
  } finally {
    live.close();
  }

  // Make the snapshot a single self-contained file (no -wal/-shm sidecars), so
  // it can be renamed atomically and read with `sqlite3 'file:...?immutable=1'`.
  const snap = new Database(input.tmpPath, { fileMustExist: true });
  try {
    snap.pragma("journal_mode = DELETE");
  } finally {
    snap.close();
  }

  return result;
}

if (parentPort) {
  const port = parentPort;
  run(workerData as SnapshotWorkerInput).then(
    (out) => port.postMessage(out),
    (err: unknown) => {
      removeIfExists((workerData as SnapshotWorkerInput).tmpPath);
      port.postMessage({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SnapshotWorkerOutput);
    }
  );
}
