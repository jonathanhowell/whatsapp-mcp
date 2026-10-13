import type { Config } from "../config/loader.js";
import {
  explainDbError,
  openLiveDatabase,
  openSnapshotFile,
  type DatabaseHandle,
} from "./connection.js";
import {
  createSnapshot,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_SNAPSHOT_TIMEOUT_MS,
  readLatestTarget,
  removeOwnSnapshot,
} from "./snapshot.js";

export type DbStatus = "pending" | "ready" | "failed";

/** Thrown by acquire() when no database is available yet (or at all). */
export class DatabaseUnavailableError extends Error {
  constructor(
    public readonly status: "snapshot_pending" | "snapshot_failed",
    message: string,
    public readonly detail: Record<string, unknown>
  ) {
    super(message);
  }

  toToolResult() {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { status: this.status, message: this.message, ...this.detail },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

export interface ManagerOptions {
  snapshotDir?: string;
  snapshotTimeoutMs?: number;
  /** How long a tool call waits for an in-flight snapshot before returning snapshot_pending. */
  acquireWaitMs?: number;
  log?: (msg: string) => void;
}

/**
 * Owns the database handle. The server connects to the MCP client first and
 * the snapshot is built in the background, so a slow or failing copy can never
 * prevent the server from answering `initialize`.
 */
export class DatabaseManager {
  private handle: DatabaseHandle | null = null;
  private inflight: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastAttemptAt: string | null = null;
  private readonly dir: string;
  private readonly timeoutMs: number;
  private readonly acquireWaitMs: number;
  private readonly log: (msg: string) => void;

  constructor(
    public readonly config: Config,
    opts: ManagerOptions = {}
  ) {
    this.dir = opts.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
    this.timeoutMs = opts.snapshotTimeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS;
    this.acquireWaitMs = opts.acquireWaitMs ?? 20_000;
    this.log = opts.log ?? ((m) => process.stderr.write(`WhatsApp MCP: ${m}\n`));
  }

  get status(): DbStatus {
    if (this.handle) return "ready";
    return this.inflight || this.lastError === null ? "pending" : "failed";
  }

  get current(): DatabaseHandle | null {
    return this.handle;
  }

  /** Begin opening the database in the background (idempotent while in flight). */
  start(): Promise<void> {
    if (!this.inflight) {
      this.lastAttemptAt = new Date().toISOString();
      this.inflight = this.load().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async load(): Promise<void> {
    try {
      const next =
        this.config.mode === "live"
          ? openLiveDatabase(this.config.dbPath)
          : await this.buildSnapshot();
      this.swap(next);
      this.lastError = null;
    } catch (err) {
      this.lastError = explainDbError(err, this.config.dbPath);
      this.log(`Database unavailable: ${this.lastError}`);
      if (!this.handle && this.config.mode === "snapshot") this.openStaleFallback();
    }
  }

  private async buildSnapshot(): Promise<DatabaseHandle> {
    const res = await createSnapshot(this.config.dbPath, {
      dir: this.dir,
      timeoutMs: this.timeoutMs,
    });
    this.log(
      `Snapshot ready at ${res.path} via ${res.method} in ${res.durationMs}ms` +
        (res.backupError ? ` (backup failed: ${res.backupError})` : "")
    );
    return openSnapshotFile(res.path);
  }

  /** Serve the last good snapshot (from any instance) rather than nothing. */
  private openStaleFallback(): void {
    const latest = readLatestTarget(this.dir);
    if (!latest) return;
    try {
      this.handle = openSnapshotFile(latest, true);
      this.log(`Serving stale snapshot ${latest} (${this.handle.createdAt})`);
    } catch (err) {
      this.log(`Stale snapshot unusable: ${explainDbError(err, latest)}`);
    }
  }

  private swap(next: DatabaseHandle): void {
    const prev = this.handle;
    this.handle = next;
    prev?.db.close();
  }

  /** Get a usable handle, waiting briefly for an in-flight open. */
  async acquire(): Promise<DatabaseHandle> {
    if (this.handle) return this.handle;
    // Previous attempt failed with nothing to fall back on: retry on demand.
    const pending = this.start();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      pending,
      new Promise((r) => {
        timer = setTimeout(r, this.acquireWaitMs);
      }),
    ]);
    clearTimeout(timer);
    if (this.handle) return this.handle;
    if (this.inflight) {
      throw new DatabaseUnavailableError(
        "snapshot_pending",
        "The WhatsApp database snapshot is still being created. Retry shortly.",
        { started_at: this.lastAttemptAt, deadline_seconds: Math.round(this.timeoutMs / 1000) }
      );
    }
    throw new DatabaseUnavailableError(
      "snapshot_failed",
      `snapshot failed: ${this.lastError}`,
      { attempted_at: this.lastAttemptAt, hint: "Call refresh_snapshot or any tool to retry." }
    );
  }

  /**
   * Replace the current data with a fresh copy. On failure the previous
   * handle is kept, so a failed refresh never leaves the server without data.
   */
  async refresh(): Promise<DatabaseHandle> {
    if (this.config.mode === "live") {
      return this.acquire();
    }
    if (this.inflight) await this.inflight;
    const prevError = this.lastError;
    this.lastError = null;
    await this.start();
    if (this.lastError !== null) {
      throw new Error(this.lastError);
    }
    if (!this.handle) throw new Error(prevError ?? "snapshot failed");
    return this.handle;
  }

  /** Human-readable note when tools are being served from a stale snapshot. */
  staleWarning(): string | null {
    if (!this.handle?.stale) return null;
    return (
      `WARNING: serving a stale snapshot captured ${this.handle.createdAt} because a fresh ` +
      `snapshot failed (${this.lastError ?? "unknown error"}). Call refresh_snapshot to retry.`
    );
  }

  close(): void {
    this.handle?.db.close();
    this.handle = null;
    if (this.config.mode === "snapshot") {
      try {
        removeOwnSnapshot(this.dir);
      } catch {
        // best effort
      }
    }
  }
}
