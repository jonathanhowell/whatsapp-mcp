import { parse } from "smol-toml";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Config {
  dbPath: string;
  mode: "snapshot" | "live";
  /** Deadline for creating a snapshot before it is aborted. */
  snapshotTimeoutSeconds: number;
}

interface TomlConfig {
  db_path?: string;
  mode?: string;
  snapshot_timeout_seconds?: number;
}

const DEFAULT_SNAPSHOT_TIMEOUT_SECONDS = 60;

function positiveNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
);

const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "whatsapp-mcp",
  "config.toml"
);

export function loadConfig(configPath?: string): Config {
  const resolvedConfigPath = configPath ?? DEFAULT_CONFIG_PATH;

  const defaults: Config = {
    dbPath: DEFAULT_DB_PATH,
    mode: "snapshot",
    snapshotTimeoutSeconds: DEFAULT_SNAPSHOT_TIMEOUT_SECONDS,
  };

  let fileConfig: Partial<Config> = {};

  if (fs.existsSync(resolvedConfigPath)) {
    const raw = fs.readFileSync(resolvedConfigPath, "utf-8");
    const parsed = parse(raw) as TomlConfig;

    if (parsed.db_path !== undefined) {
      fileConfig.dbPath = parsed.db_path;
    }

    if (parsed.mode === "live" || parsed.mode === "snapshot") {
      fileConfig.mode = parsed.mode;
    }

    const timeout = positiveNumber(parsed.snapshot_timeout_seconds);
    if (timeout !== undefined) {
      fileConfig.snapshotTimeoutSeconds = timeout;
    }
  }

  const merged: Config = {
    ...defaults,
    ...fileConfig,
  };

  // Environment variables take precedence (D-10)
  if (process.env.WHATSAPP_DB_PATH) {
    merged.dbPath = process.env.WHATSAPP_DB_PATH;
  }

  if (process.env.WHATSAPP_DB_MODE === "live" || process.env.WHATSAPP_DB_MODE === "snapshot") {
    merged.mode = process.env.WHATSAPP_DB_MODE;
  }

  const envTimeout = positiveNumber(process.env.WHATSAPP_SNAPSHOT_TIMEOUT_SECONDS);
  if (envTimeout !== undefined) {
    merged.snapshotTimeoutSeconds = envTimeout;
  }

  return merged;
}
