import type Database from "better-sqlite3";

export const REQUIRED_TABLES = [
  "ZWAMESSAGE",
  "ZWACHATSESSION",
  "ZWAMEDIAITEM",
  "ZWAPROFILEPUSHNAME",
] as const;

export function validateSchema(db: Database.Database): void {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  const tableNames = rows.map((r) => r.name);
  const missing = REQUIRED_TABLES.filter((t) => !tableNames.includes(t));

  if (missing.length > 0) {
    throw new Error(
      `WhatsApp database schema unexpected. Missing tables: ${missing.join(", ")}. ` +
        `Ensure the WhatsApp Desktop app has been opened at least once.`
    );
  }
}
