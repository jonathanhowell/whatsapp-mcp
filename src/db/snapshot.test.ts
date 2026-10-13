import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  cleanStaleSnapshots,
  createSnapshot,
  LATEST_LINK,
  readLatestTarget,
  removeOwnSnapshot,
  snapshotPathFor,
} from "./snapshot.js";
import { deadPid, makeFakeChatStorage, makeTmpDir } from "../test/fixtures.js";

describe("createSnapshot", () => {
  let work: string;
  let snapDir: string;
  let live: string;

  beforeEach(() => {
    work = makeTmpDir();
    snapDir = path.join(work, "snaps");
    live = makeFakeChatStorage(work, (db) =>
      db.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME) VALUES (1, 'Alice')").run()
    );
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it("writes a per-pid snapshot, points latest at it, and leaves no tmp file", async () => {
    const res = await createSnapshot(live, { dir: snapDir });
    assert.equal(res.path, snapshotPathFor(snapDir, process.pid));
    assert.equal(readLatestTarget(snapDir), res.path);
    assert.ok(!fs.existsSync(`${res.path}.tmp`));
    const db = new Database(res.path, { readonly: true });
    assert.equal(db.pragma("journal_mode", { simple: true }), "delete");
    assert.equal((db.prepare("SELECT ZPARTNERNAME n FROM ZWACHATSESSION").get() as any).n, "Alice");
    db.close();
  });

  it("does not touch the live DB beyond reading it", async () => {
    const before = fs.readFileSync(live);
    await createSnapshot(live, { dir: snapDir });
    assert.deepEqual(fs.readFileSync(live), before);
  });

  it("keeps the previous good snapshot when a new one fails", async () => {
    const good = await createSnapshot(live, { dir: snapDir });
    await assert.rejects(createSnapshot(path.join(work, "missing.sqlite"), { dir: snapDir }));
    assert.ok(fs.existsSync(good.path));
    assert.equal(readLatestTarget(snapDir), good.path);
    assert.ok(!fs.existsSync(`${good.path}.tmp`));
  });

  it("aborts at the deadline without leaving a tmp file", async () => {
    await assert.rejects(createSnapshot(live, { dir: snapDir, timeoutMs: 1 }), /deadline/);
    assert.ok(!fs.existsSync(`${snapshotPathFor(snapDir, process.pid)}.tmp`));
  });

  it("completes while another process writes continuously (no backup starvation)", async () => {
    const w = new Database(live);
    w.exec("CREATE TABLE filler (x BLOB)");
    const ins = w.prepare("INSERT INTO filler VALUES (randomblob(4000))");
    w.transaction(() => {
      for (let i = 0; i < 5000; i++) ins.run();
    })();
    w.close();
    // A WhatsApp-like trickle: one small commit every 5 ms. With
    // better-sqlite3's default 100-pages-per-step backup this restarts forever.
    const writer = spawn(process.execPath, [
      "-e",
      `const D=require("better-sqlite3");const d=new D(${JSON.stringify(live)});` +
        `d.pragma("busy_timeout=1000");const u=d.prepare("UPDATE filler SET x=randomblob(4000) WHERE rowid=?");` +
        `setInterval(()=>u.run(1+Math.floor(Math.random()*5000)),5)`,
    ], { cwd: process.cwd(), stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 300));
      const res = await createSnapshot(live, { dir: snapDir, timeoutMs: 10_000 });
      assert.equal(res.method, "backup");
      assert.ok(res.durationMs < 10_000);
    } finally {
      writer.kill();
    }
  });

  it("only cleans snapshots of dead instances after a successful copy", async () => {
    fs.mkdirSync(snapDir, { recursive: true });
    const dead = deadPid();
    const deadFile = snapshotPathFor(snapDir, dead);
    const liveOwner = snapshotPathFor(snapDir, process.ppid); // a running process
    fs.writeFileSync(deadFile, "x");
    fs.writeFileSync(`${deadFile}.tmp`, "x");
    fs.writeFileSync(liveOwner, "x");
    fs.writeFileSync(path.join(snapDir, "unrelated.txt"), "x");

    await createSnapshot(live, { dir: snapDir });

    assert.ok(!fs.existsSync(deadFile));
    assert.ok(!fs.existsSync(`${deadFile}.tmp`));
    assert.ok(fs.existsSync(liveOwner), "a running instance's snapshot must survive");
    assert.ok(fs.existsSync(path.join(snapDir, "unrelated.txt")));
  });
});

describe("cleanStaleSnapshots / removeOwnSnapshot", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("never removes the latest target, even if its owner is dead", () => {
    const dead = deadPid();
    const f = snapshotPathFor(dir, dead);
    fs.writeFileSync(f, "x");
    fs.symlinkSync(path.basename(f), path.join(dir, LATEST_LINK));
    cleanStaleSnapshots(dir);
    assert.ok(fs.existsSync(f));
  });

  it("on exit keeps our snapshot only if it is latest", () => {
    const own = snapshotPathFor(dir, process.pid);
    fs.writeFileSync(own, "x");
    removeOwnSnapshot(dir);
    assert.ok(!fs.existsSync(own));

    fs.writeFileSync(own, "x");
    fs.symlinkSync(path.basename(own), path.join(dir, LATEST_LINK));
    removeOwnSnapshot(dir);
    assert.ok(fs.existsSync(own));
  });
});
