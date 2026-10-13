import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseManager, DatabaseUnavailableError } from "./manager.js";
import { createSnapshot } from "./snapshot.js";
import { makeFakeChatStorage, makeTmpDir } from "../test/fixtures.js";

const quiet = () => {};

describe("DatabaseManager", () => {
  let work: string;
  let snapDir: string;
  beforeEach(() => {
    work = makeTmpDir();
    snapDir = path.join(work, "snaps");
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  const mk = (dbPath: string, mode: "snapshot" | "live" = "snapshot") =>
    new DatabaseManager(
      { dbPath, mode, snapshotTimeoutSeconds: 10 },
      { snapshotDir: snapDir, log: quiet, acquireWaitMs: 5_000 }
    );

  it("is pending before start and ready after", async () => {
    const m = mk(makeFakeChatStorage(work));
    assert.equal(m.status, "pending");
    const h = await m.acquire();
    assert.equal(m.status, "ready");
    assert.equal(h.mode, "snapshot");
    assert.equal(h.stale, false);
    m.close();
  });

  it("returns a structured snapshot_failed when nothing is available", async () => {
    const m = mk(path.join(work, "missing.sqlite"));
    await assert.rejects(m.acquire(), (err: unknown) => {
      assert.ok(err instanceof DatabaseUnavailableError);
      assert.equal(err.status, "snapshot_failed");
      const body = JSON.parse(err.toToolResult().content[0].text);
      assert.equal(body.status, "snapshot_failed");
      assert.match(body.message, /^snapshot failed: /);
      return true;
    });
    assert.equal(m.status, "failed");
  });

  it("returns snapshot_pending when the copy outlasts the acquire wait", async () => {
    const m = new DatabaseManager(
      { dbPath: makeFakeChatStorage(work), mode: "snapshot", snapshotTimeoutSeconds: 10 },
      { snapshotDir: snapDir, log: quiet, acquireWaitMs: 0 }
    );
    await assert.rejects(m.acquire(), (err: unknown) =>
      err instanceof DatabaseUnavailableError && err.status === "snapshot_pending"
    );
    await m.start();
    assert.equal(m.status, "ready");
    m.close();
  });

  it("falls back to the last good snapshot (latest.sqlite) and flags it stale", async () => {
    await createSnapshot(makeFakeChatStorage(work), { dir: snapDir, pid: 1 });
    const m = mk(path.join(work, "missing.sqlite"));
    const h = await m.acquire();
    assert.equal(h.stale, true);
    assert.match(m.staleWarning() ?? "", /stale snapshot/);
    m.close();
  });

  it("keeps serving the previous snapshot when refresh fails", async () => {
    const live = makeFakeChatStorage(work);
    const m = mk(live);
    const first = await m.acquire();
    fs.renameSync(live, `${live}.gone`);
    await assert.rejects(m.refresh());
    assert.equal(m.current, first);
    assert.equal(
      (first.db.prepare("SELECT count(*) c FROM ZWAMESSAGE").get() as { c: number }).c,
      0
    );
    m.close();
  });

  it("refresh swaps in a new snapshot", async () => {
    const m = mk(makeFakeChatStorage(work));
    const first = await m.acquire();
    const second = await m.refresh();
    assert.notEqual(first, second);
    assert.equal(first.db.open, false);
    m.close();
  });
});
