import "server-only";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";

const defaultPreferences: Preferences = {
  defaultLocation: "Lapu-Lapu City, Cebu, Philippines",
  theme: "dark",
  raceDate: "2027-03-14",
  planRowCount: 1,
  provider: "openai",
  model: "gpt-6-luna",
  lthr: null,
};

function json<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

const globalDatabase = globalThis as typeof globalThis & { strideLocalDatabase?: DatabaseSync; strideCloudDatabase?: ReturnType<typeof createClient>; strideDbReady?: Promise<void> };
const cloudUrl = process.env.TURSO_DATABASE_URL || process.env.stride_TURSO_DATABASE_URL;
const cloudAuthToken = process.env.TURSO_AUTH_TOKEN || process.env.stride_TURSO_AUTH_TOKEN;
if (process.env.VERCEL && !cloudUrl) throw new Error("Connect a Turso database before deploying Stride to Vercel.");
if (cloudUrl && !cloudAuthToken) throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.");
const cloud = cloudUrl ? globalDatabase.strideCloudDatabase ?? createClient({ url: cloudUrl, authToken: cloudAuthToken }) : undefined;
if (cloud) globalDatabase.strideCloudDatabase = cloud;
let local: DatabaseSync | undefined;
if (!cloud) {
  const localPath = path.resolve(process.env.STRIDE_DB_PATH || path.join(process.cwd(), "data", "stride.sqlite"));
  mkdirSync(path.dirname(localPath), { recursive: true });
  local = globalDatabase.strideLocalDatabase ?? new DatabaseSync(localPath);
  globalDatabase.strideLocalDatabase = local;
  local.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
}

async function ensureReady() {
  if (!globalDatabase.strideDbReady) {
    globalDatabase.strideDbReady = (async () => {
      const schema = [
        "CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ];
      if (cloud) for (const sql of schema) await cloud.execute(sql);
      else local?.exec(schema.join(";"));
    })();
  }
  await globalDatabase.strideDbReady;
}

function getLocalBundle(): Bundle {
  const runs = local!.prepare("SELECT id, payload FROM runs ORDER BY json_extract(payload, '$.date') DESC, id DESC").all() as { id: number; payload: string }[];
  const workouts = local!.prepare("SELECT id, payload FROM workouts ORDER BY json_extract(payload, '$.date'), id").all() as { id: string; payload: string }[];
  const settings = Object.fromEntries((local!.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  const meta = Object.fromEntries((local!.prepare("SELECT key, value FROM metadata").all() as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  return {
    runs: runs.map((row) => ({ ...json<Run>(row.payload, {} as Run), id: row.id })),
    plan: workouts.map((row) => json<Workout>(row.payload, { id: row.id, date: "", week: 0, session: "" })),
    meta,
    preferences: { ...defaultPreferences, ...settings } as Preferences,
    storage: "SQLite",
  };
}

export async function getBundle(): Promise<Bundle> {
  await ensureReady();
  if (!cloud) return getLocalBundle();
  const [runsResult, workoutsResult, settingsResult, metaResult] = await Promise.all([
    cloud.execute("SELECT id, payload FROM runs ORDER BY json_extract(payload, '$.date') DESC, id DESC"),
    cloud.execute("SELECT id, payload FROM workouts ORDER BY json_extract(payload, '$.date'), id"),
    cloud.execute("SELECT key, value FROM settings"),
    cloud.execute("SELECT key, value FROM metadata"),
  ]);
  const runs = runsResult.rows as unknown as { id: number; payload: string }[];
  const workouts = workoutsResult.rows as unknown as { id: string; payload: string }[];
  const settings = Object.fromEntries((settingsResult.rows as unknown as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  const meta = Object.fromEntries((metaResult.rows as unknown as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  return {
    runs: runs.map((row) => ({ ...json<Run>(row.payload, {} as Run), id: Number(row.id) })),
    plan: workouts.map((row) => json<Workout>(row.payload, { id: row.id, date: "", week: 0, session: "" })),
    meta,
    preferences: { ...defaultPreferences, ...settings } as Preferences,
    storage: "Turso",
  };
}

export async function saveBundle(bundle: Partial<Bundle>): Promise<Bundle> {
  await ensureReady();
  if (!cloud) {
    local!.exec("BEGIN IMMEDIATE");
    try {
      if (bundle.runs) {
        local!.exec("DELETE FROM runs");
        const insert = local!.prepare("INSERT INTO runs (payload) VALUES (?)");
        const insertWithId = local!.prepare("INSERT INTO runs (id, payload) VALUES (?, ?)");
        for (const run of bundle.runs) {
          const { id: _id, ...payload } = run;
          if (Number.isInteger(run.id) && Number(run.id) > 0) insertWithId.run(Number(run.id), JSON.stringify(payload));
          else insert.run(JSON.stringify(payload));
        }
      }
      if (bundle.plan) {
        local!.exec("DELETE FROM workouts");
        const insert = local!.prepare("INSERT INTO workouts (id, payload) VALUES (?, ?)");
        bundle.plan.forEach((workout, index) => insert.run(String(workout.id ?? `workout-${index}`), JSON.stringify(workout)));
      }
      if (bundle.preferences) {
        const upsert = local!.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        for (const [key, value] of Object.entries(bundle.preferences)) upsert.run(key, JSON.stringify(value));
      }
      if (bundle.meta) {
        const upsert = local!.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        for (const [key, value] of Object.entries(bundle.meta)) upsert.run(key, JSON.stringify(value));
      }
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
    return getLocalBundle();
  }

  const statements: { sql: string; args?: (string | number | null)[] }[] = [];
  if (bundle.runs) {
    statements.push({ sql: "DELETE FROM runs" });
    for (const run of bundle.runs) {
      const { id, ...payload } = run;
      if (Number.isInteger(id) && Number(id) > 0) statements.push({ sql: "INSERT INTO runs (id, payload) VALUES (?, ?)", args: [Number(id), JSON.stringify(payload)] });
      else statements.push({ sql: "INSERT INTO runs (payload) VALUES (?)", args: [JSON.stringify(payload)] });
    }
  }
  if (bundle.plan) {
    statements.push({ sql: "DELETE FROM workouts" });
    for (const [index, workout] of bundle.plan.entries()) statements.push({ sql: "INSERT INTO workouts (id, payload) VALUES (?, ?)", args: [String(workout.id ?? `workout-${index}`), JSON.stringify(workout)] });
  }
  for (const [table, values] of [["settings", bundle.preferences], ["metadata", bundle.meta]] as const) {
    if (!values) continue;
    for (const [key, value] of Object.entries(values)) statements.push({ sql: `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, args: [key, JSON.stringify(value)] });
  }
  if (statements.length) await cloud.batch(statements, "write");
  return getBundle();
}

export async function hasMigratedLegacyData() {
  await ensureReady();
  if (cloud) return (await cloud.execute("SELECT key FROM metadata WHERE key = 'legacy_imported' LIMIT 1")).rows.length > 0;
  return local!.prepare("SELECT key FROM metadata WHERE key = 'legacy_imported' LIMIT 1").get() !== undefined;
}

export async function markLegacyDataMigrated() {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "INSERT INTO metadata (key, value) VALUES ('legacy_imported', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'" });
  else local!.prepare("INSERT INTO metadata (key, value) VALUES ('legacy_imported', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
}
