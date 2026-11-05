import "server-only";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";
import { STRENGTH_PLAN_SEED_KEY, strengthPlanWorkouts } from "@/lib/strength-plan";

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
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer')",
        "CREATE TABLE IF NOT EXISTS run_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
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


/**
 * Add strength sessions from the revised SM2SM workbook exactly once.
 * This uses INSERT-only SQL; it never deletes or updates a Run, Workout,
 * preference, review, or secret. A marker prevents restoring workouts the
 * user intentionally removes afterward.
 */
export async function ensureStrengthPlan() {
  await ensureReady();
  if (cloud) {
    const found = await cloud.execute({ sql: "SELECT key FROM metadata WHERE key = ? LIMIT 1", args: [STRENGTH_PLAN_SEED_KEY] });
    if (found.rows.length) return;
    const statements = strengthPlanWorkouts.map((workout) => ({
      sql: "INSERT INTO workouts (id, payload) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
      args: [String(workout.id), JSON.stringify(workout)],
    }));
    statements.push({
      sql: "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
      args: [STRENGTH_PLAN_SEED_KEY, JSON.stringify("added from 18-Week Plan and Strength A + B workbook sheets")],
    });
    await cloud.batch(statements, "write");
    return;
  }

  local!.exec("BEGIN IMMEDIATE");
  try {
    const existing = local!.prepare("SELECT key FROM metadata WHERE key = ? LIMIT 1").get(STRENGTH_PLAN_SEED_KEY);
    if (!existing) {
      const statement = local!.prepare("INSERT INTO workouts (id, payload) VALUES (?, ?) ON CONFLICT(id) DO NOTHING");
      for (const workout of strengthPlanWorkouts) statement.run(String(workout.id), JSON.stringify(workout));
      local!.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING")
        .run(STRENGTH_PLAN_SEED_KEY, JSON.stringify("added from 18-Week Plan and Strength A + B workbook sheets"));
    }
    local!.exec("COMMIT");
  } catch (error) {
    local!.exec("ROLLBACK");
    throw error;
  }
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

export async function getStoredAccount(username: string) {
  await ensureReady();
  if (cloud) {
    const result = await cloud.execute({ sql: "SELECT id, username, salt, password_hash, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1", args: [username] });
    return result.rows[0] as unknown as { id: string; username: string; salt: string; password_hash: string; role: string } | undefined;
  }
  return local!.prepare("SELECT id, username, salt, password_hash, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1").get(username) as { id: string; username: string; salt: string; password_hash: string; role: string } | undefined;
}

export async function listAccounts() {
  await ensureReady();
  if (cloud) return (await cloud.execute("SELECT id, username, role FROM users ORDER BY username")).rows as unknown as { id: string; username: string; role: string }[];
  return local!.prepare("SELECT id, username, role FROM users ORDER BY username").all() as { id: string; username: string; role: string }[];
}

export async function createAccount(id: string, username: string, salt: string, passwordHash: string) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "INSERT INTO users (id, username, salt, password_hash, role) VALUES (?, ?, ?, ?, 'viewer')", args: [id, username, salt, passwordHash] });
  else local!.prepare("INSERT INTO users (id, username, salt, password_hash, role) VALUES (?, ?, ?, ?, 'viewer')").run(id, username, salt, passwordHash);
}

export async function deleteAccount(id: string) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
  else local!.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export async function getComments() {
  await ensureReady();
  if (cloud) return (await cloud.execute("SELECT id, run_id AS runId, username, text, created_at AS createdAt FROM run_comments ORDER BY created_at, id")).rows as unknown as import("@/lib/types").RunComment[];
  return local!.prepare("SELECT id, run_id AS runId, username, text, created_at AS createdAt FROM run_comments ORDER BY created_at, id").all() as import("@/lib/types").RunComment[];
}

export async function addComment(runId: number, username: string, text: string) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "INSERT INTO run_comments (run_id, username, text) VALUES (?, ?, ?)", args: [runId, username, text] });
  else local!.prepare("INSERT INTO run_comments (run_id, username, text) VALUES (?, ?, ?)").run(runId, username, text);
}

export async function removeComment(id: number, username: string, isAdmin: boolean) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: isAdmin ? "DELETE FROM run_comments WHERE id = ?" : "DELETE FROM run_comments WHERE id = ? AND username = ?", args: isAdmin ? [id] : [id, username] });
  else local!.prepare(isAdmin ? "DELETE FROM run_comments WHERE id = ?" : "DELETE FROM run_comments WHERE id = ? AND username = ?").run(...(isAdmin ? [id] : [id, username]));
}

export async function getSecret(key: string) {
  await ensureReady();
  if (cloud) return (await cloud.execute({ sql: "SELECT value FROM secrets WHERE key = ?", args: [key] })).rows[0]?.value as string | undefined;
  return (local!.prepare("SELECT value FROM secrets WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export async function setSecret(key: string, value: string) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, value] });
  else local!.prepare("INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export async function deleteSecret(key: string) {
  await ensureReady();
  if (cloud) await cloud.execute({ sql: "DELETE FROM secrets WHERE key = ?", args: [key] });
  else local!.prepare("DELETE FROM secrets WHERE key = ?").run(key);
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
