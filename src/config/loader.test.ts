import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./loader.js";

// Store and restore env vars between tests
let savedEnv: Record<string, string | undefined> = {};

function saveEnv() {
  savedEnv = {
    WHATSAPP_DB_PATH: process.env.WHATSAPP_DB_PATH,
    WHATSAPP_DB_MODE: process.env.WHATSAPP_DB_MODE,
    WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS: process.env.WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS,
  };
}

function restoreEnv() {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

describe("loadConfig", () => {
  let tmpDir: string;
  let tmpConfigPath: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-mcp-test-"));
    tmpConfigPath = path.join(tmpDir, "config.toml");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    saveEnv();
    delete process.env.WHATSAPP_DB_PATH;
    delete process.env.WHATSAPP_DB_MODE;
    delete process.env.WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS;
    // Ensure test config file doesn't exist at start of each test
    if (fs.existsSync(tmpConfigPath)) {
      fs.unlinkSync(tmpConfigPath);
    }
  });

  afterEach(() => {
    restoreEnv();
    if (fs.existsSync(tmpConfigPath)) {
      fs.unlinkSync(tmpConfigPath);
    }
  });

  it("returns defaults when no TOML file and no env vars", () => {
    const nonExistentPath = path.join(tmpDir, "nonexistent.toml");
    const config = loadConfig(nonExistentPath);
    const expectedDbPath = path.join(
      os.homedir(),
      "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
    );
    assert.strictEqual(config.dbPath, expectedDbPath);
    assert.strictEqual(config.mode, "snapshot");
  });

  it("returns dbPath from TOML file when present", () => {
    fs.writeFileSync(tmpConfigPath, 'db_path = "/custom/path.sqlite"\n');
    const config = loadConfig(tmpConfigPath);
    assert.strictEqual(config.dbPath, "/custom/path.sqlite");
  });

  it("returns mode from TOML file when set to live", () => {
    fs.writeFileSync(tmpConfigPath, 'mode = "live"\n');
    const config = loadConfig(tmpConfigPath);
    assert.strictEqual(config.mode, "live");
  });

  it("env var WHATSAPP_DB_PATH overrides TOML db_path", () => {
    fs.writeFileSync(tmpConfigPath, 'db_path = "/toml/path.sqlite"\n');
    process.env.WHATSAPP_DB_PATH = "/env/path.sqlite";
    const config = loadConfig(tmpConfigPath);
    assert.strictEqual(config.dbPath, "/env/path.sqlite");
  });

  it("env var WHATSAPP_DB_MODE overrides TOML mode", () => {
    fs.writeFileSync(tmpConfigPath, 'mode = "snapshot"\n');
    process.env.WHATSAPP_DB_MODE = "live";
    const config = loadConfig(tmpConfigPath);
    assert.strictEqual(config.mode, "live");
  });

  it("missing TOML file does not throw and returns defaults", () => {
    const missingPath = path.join(tmpDir, "does-not-exist.toml");
    assert.doesNotThrow(() => loadConfig(missingPath));
    const config = loadConfig(missingPath);
    assert.strictEqual(config.mode, "snapshot");
  });

  it("snapshot timeout defaults to 60s, reads TOML, and env overrides", () => {
    assert.strictEqual(loadConfig(path.join(tmpDir, "none.toml")).snapshotTimeoutSeconds, 60);
    fs.writeFileSync(tmpConfigPath, "snapshot_timeout_seconds = 15\n");
    assert.strictEqual(loadConfig(tmpConfigPath).snapshotTimeoutSeconds, 15);
    process.env.WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS = "5";
    assert.strictEqual(loadConfig(tmpConfigPath).snapshotTimeoutSeconds, 5);
    process.env.WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS = "nonsense";
    assert.strictEqual(loadConfig(tmpConfigPath).snapshotTimeoutSeconds, 15);
  });
});
