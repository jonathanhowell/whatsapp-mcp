import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { makeFakeChatStorage, makeTmpDir } from "./test/fixtures.js";

// End-to-end over stdio: the server must answer `initialize` immediately,
// regardless of whether the database is usable.
function startServer(env: Record<string, string>) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(import.meta.dirname, "index.ts")],
    { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] }
  ) as ChildProcessWithoutNullStreams;
  const pending = new Map<number, (msg: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let nextId = 1;
  const request = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const initialize = async () => {
    const res = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return res;
  };
  const callTool = async (name: string, args: object = {}) =>
    JSON.parse((await request("tools/call", { name, arguments: args })).result.content[0].text);
  return { child, initialize, callTool };
}

describe("server startup", () => {
  let work: string;
  let server: ReturnType<typeof startServer> | undefined;
  beforeEach(() => (work = makeTmpDir()));
  afterEach(() => {
    server?.child.kill();
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("answers initialize and reports snapshot_failed when the DB is unreadable", async () => {
    server = startServer({ WHATSAPP_DB_PATH: path.join(work, "missing.sqlite"), TMPDIR: work });
    const t0 = Date.now();
    const init = await server.initialize();
    assert.ok(init.result.serverInfo, "initialize must succeed");
    assert.ok(Date.now() - t0 < 10_000);
    const res = await server.callTool("list_chats");
    assert.equal(res.status, "snapshot_failed");
  });

  it("serves data once the background snapshot is ready", async () => {
    const live = makeFakeChatStorage(work, (db) =>
      db.prepare("INSERT INTO ZWACHATSESSION (Z_PK, ZPARTNERNAME, ZSESSIONTYPE) VALUES (7, 'Bob', 0)").run()
    );
    server = startServer({ WHATSAPP_DB_PATH: live, TMPDIR: work });
    await server.initialize();
    const res = await server.callTool("list_chats");
    assert.equal(res.chats[0].name, "Bob");
    assert.ok(fs.existsSync(path.join(work, "whatsapp-mcp", "latest.sqlite")));
  });

  it("exits cleanly when stdin closes", async () => {
    server = startServer({ WHATSAPP_DB_PATH: path.join(work, "missing.sqlite"), TMPDIR: work });
    await server.initialize();
    const exited = new Promise<number | null>((r) => server!.child.once("exit", r));
    server.child.stdin.end();
    assert.equal(await exited, 0);
  });
});
