import { parse } from "smol-toml";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Config {
  dbPath: string;
  mode: "snapshot" | "live";
}

interface TomlConfig {
  db_path?: string;
  mode?: string;
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

  return merged;
}
