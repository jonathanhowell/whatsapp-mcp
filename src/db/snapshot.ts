import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Worker } from "node:worker_threads";
import type {
  SnapshotWorkerInput,
  SnapshotWorkerOutput,
} from "./snapshot-worker.js";

export const DEFAULT_SNAPSHOT_DIR = path.join(os.tmpdir(), "whatsapp-mcp");

// Stable, discoverable pointer to the most recent good snapshot from any
// instance. Headless consumers can read it with
//   sqlite3 "file:$TMPDIR/whatsapp-mcp/latest.sqlite?immutable=1"
export const LATEST_LINK = "latest.sqlite";

const SNAPSHOT_RE = /^snapshot-(\d+)\.sqlite(\.tmp)?(-wal|-shm|-journal)?$/;

export interface SnapshotOptions {
  dir?: string;
  /** Owner pid embedded in the filename. Defaults to this process. */
  pid?: number;
  /** Hard deadline for the copy; the worker is terminated on expiry. */
  timeoutMs?: number;
  /** Max backup restarts before falling back to VACUUM INTO. */
  maxRestarts?: number;
}

export interface SnapshotResult {
  path: string;
  method: "backup" | "vacuum_into";
  durationMs: number;
  backupError?: string;
}

export const DEFAULT_SNAPSHOT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESTARTS = 3;

export function snapshotPathFor(dir: string, pid: number): string {
  return path.join(dir, `snapshot-${pid}.sqlite`);
}

export function isPidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM: exists but owned by someone else
    return err?.code === "EPERM";
  }
}

export function readLatestTarget(dir: string = DEFAULT_SNAPSHOT_DIR): string | null {
  try {
    const target = fs.readlinkSync(path.join(dir, LATEST_LINK));
    const abs = path.resolve(dir, target);
    return fs.existsSync(abs) ? abs : null;
  } catch {
    return null;
  }
}

function pointLatestAt(dir: string, snapshotPath: string): void {
  // Atomic replace: create a uniquely named link, then rename over the old one.
  const tmpLink = path.join(dir, `.${LATEST_LINK}.${process.pid}.tmp`);
  try {
    fs.unlinkSync(tmpLink);
  } catch {
    // not present
  }
  fs.symlinkSync(path.basename(snapshotPath), tmpLink);
  fs.renameSync(tmpLink, path.join(dir, LATEST_LINK));
}

/**
 * Remove snapshot files whose owning process is gone. Never touches files of a
 * live instance, and never removes the current `latest.sqlite` target, so the
 * last good snapshot survives until a newer one replaces it.
 */
export function cleanStaleSnapshots(dir: string = DEFAULT_SNAPSHOT_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  const latest = readLatestTarget(dir);
  const latestBase = latest ? path.basename(latest) : null;
  const removed: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    const m = SNAPSHOT_RE.exec(file);
    if (!m) continue;
    const pid = Number(m[1]);
    if (isPidAlive(pid)) continue;
    const isTmp = Boolean(m[2]);
    const base = `snapshot-${pid}.sqlite`;
    if (!isTmp && base === latestBase) continue;
    try {
      fs.unlinkSync(path.join(dir, file));
      removed.push(file);
    } catch {
      // raced with another instance; fine
    }
  }
  return removed;
}

/** On exit: drop our snapshot unless it is the one `latest.sqlite` points at. */
export function removeOwnSnapshot(dir: string = DEFAULT_SNAPSHOT_DIR, pid: number = process.pid): void {
  const own = snapshotPathFor(dir, pid);
  const latest = readLatestTarget(dir);
  const files = [`${own}.tmp`];
  if (latest !== own) files.push(own);
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      // not present
    }
  }
}

function workerUrl(): URL {
  // Under tsx (tests/dev) the sibling is .ts; in the build it is .js.
  const self = new URL(import.meta.url);
  const ext = self.pathname.endsWith(".ts") ? ".ts" : ".js";
  return new URL(`./snapshot-worker${ext}`, self);
}

function runWorker(input: SnapshotWorkerInput, timeoutMs: number): Promise<SnapshotWorkerOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl(), { workerData: input });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(
          new Error(
            `snapshot copy exceeded ${Math.round(timeoutMs / 1000)}s deadline and was aborted`
          )
        );
      });
    }, timeoutMs);
    timer.unref();
    worker.once("message", (out: SnapshotWorkerOutput) => finish(() => resolve(out)));
    worker.once("error", (err) => finish(() => reject(err)));
    worker.once("exit", (code) =>
      finish(() => reject(new Error(`snapshot worker exited unexpectedly (code ${code})`)))
    );
  });
}

/**
 * Create a WAL-consistent snapshot of the live DB for this instance.
 * Copies to `snapshot-<pid>.sqlite.tmp`, renames into place on success, then
 * repoints `latest.sqlite` and only afterwards cleans up dead instances' files.
 * The live DB is only ever opened read-only.
 */
export async function createSnapshot(
  liveDbPath: string,
  opts: SnapshotOptions = {}
): Promise<SnapshotResult> {
  const dir = opts.dir ?? DEFAULT_SNAPSHOT_DIR;
  const pid = opts.pid ?? process.pid;
  const finalPath = snapshotPathFor(dir, pid);
  const tmpPath = `${finalPath}.tmp`;
  fs.mkdirSync(dir, { recursive: true });

  const started = Date.now();
  let out: SnapshotWorkerOutput;
  try {
    out = await runWorker(
      { liveDbPath, tmpPath, maxRestarts: opts.maxRestarts ?? DEFAULT_MAX_RESTARTS },
      opts.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS
    );
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // not present
    }
    throw err;
  }
  if (!out.ok) {
    throw new Error(out.error ?? "snapshot failed");
  }

  // Atomic promote. Any connection still open on the previous file keeps
  // reading the old inode, so in-flight readers are unaffected.
  fs.renameSync(tmpPath, finalPath);
  pointLatestAt(dir, finalPath);
  cleanStaleSnapshots(dir);

  return {
    path: finalPath,
    method: out.method ?? "backup",
    durationMs: Date.now() - started,
    backupError: out.backupError,
  };
}
