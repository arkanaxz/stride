import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local first.");

const localPath = path.resolve(process.env.STRIDE_DB_PATH || path.join(process.cwd(), "data", "stride.sqlite"));
const local = new DatabaseSync(localPath, { readOnly: true });
const cloud = createClient({ url, authToken });

try {
  const schema = [
    "CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ];
  for (const statement of schema) await cloud.execute(statement);
  const counts = await Promise.all(["runs", "workouts", "settings", "metadata"].map(async (table) => {
    const result = await cloud.execute(`SELECT COUNT(*) AS count FROM ${table}`);
    return Number(result.rows[0].count);
  }));
  if (counts.some((count) => count > 0)) throw new Error("The Turso database is not empty. Migration stopped without changing it.");

  const runs = local.prepare("SELECT id, payload FROM runs ORDER BY id").all();
  const workouts = local.prepare("SELECT id, payload FROM workouts ORDER BY id").all();
  const settings = local.prepare("SELECT key, value FROM settings").all();
  const metadata = local.prepare("SELECT key, value FROM metadata").all();
  const statements = [
    ...runs.map((row) => ({ sql: "INSERT INTO runs (id, payload) VALUES (?, ?)", args: [row.id, row.payload] })),
    ...workouts.map((row) => ({ sql: "INSERT INTO workouts (id, payload) VALUES (?, ?)", args: [row.id, row.payload] })),
    ...settings.map((row) => ({ sql: "INSERT INTO settings (key, value) VALUES (?, ?)", args: [row.key, row.value] })),
    ...metadata.map((row) => ({ sql: "INSERT INTO metadata (key, value) VALUES (?, ?)", args: [row.key, row.value] })),
  ];
  if (statements.length) await cloud.batch(statements, "write");
  console.log(`Migrated ${runs.length} runs, ${workouts.length} workouts, settings, and metadata to Turso.`);
} finally {
  local.close();
  await cloud.close();
}
