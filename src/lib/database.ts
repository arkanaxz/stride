import "server-only";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";
import { STRENGTH_PLAN_SEED_KEY, strengthPlanWorkouts } from "@/lib/strength-plan";
import { AUTHORITATIVE_PLAN_KEY, authoritativeWorkouts } from "@/lib/sm2sm-workbook-plan";

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
  // Allow concurrent Next.js build workers to wait briefly for SQLite WAL locks.
  local.exec("PRAGMA busy_timeout = 5000;");
  local.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
}

async function ensureReady() {
  if (!globalDatabase.strideDbReady) {
    globalDatabase.strideDbReady = (async () => {
      const schema = [
        "CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS run_history_baseline (run_id INTEGER PRIMARY KEY, payload TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS run_history_backups (backup_id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, payload TEXT NOT NULL, reason TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS workout_plan_backups (migration_key TEXT NOT NULL, workout_id TEXT NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (migration_key, workout_id))",
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer')",
        "CREATE TABLE IF NOT EXISTS run_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ];
      if (cloud) {
        for (const sql of schema) await cloud.execute(sql);
        // Save a non-destructive baseline of every currently present run, once.
        await cloud.execute("INSERT OR IGNORE INTO run_history_baseline (run_id, payload) SELECT id, payload FROM runs");
      } else {
        local?.exec(schema.join(";"));
        local?.exec("INSERT OR IGNORE INTO run_history_baseline (run_id, payload) SELECT id, payload FROM runs");
      }
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


/**
 * One-time server-side replacement of the ACTIVE Training Block from the
 * user's latest workbook. Before replacing any entry, archive every original
 * workout payload into workout_plan_backups in the same SQLite transaction.
 *
 * Completed/cancelled statuses on matching sessions are carried forward.
 * Completed/cancelled sessions not in the workbook are preserved in the backup
 * (not shown as obsolete Training Block rows). Historical RUNS, AI reviews,
 * comments, secrets, shoe mileage and unrelated preferences are never touched.
 *
 * This is intentionally NOT an Excel import operation.
 */
export async function ensureAuthoritativeWorkbookPlan(): Promise<void> {
  await ensureReady();
  const workbook = authoritativeWorkouts(); // Validate hash, count and ID uniqueness before any SQL.
  const markerSql = "SELECT key FROM metadata WHERE key = ? LIMIT 1";
  const markerArgs = [AUTHORITATIVE_PLAN_KEY];

  if (cloud) {
    const alreadyApplied = await cloud.execute({ sql: markerSql, args: markerArgs });
    if (alreadyApplied.rows.length) return;

    const before = await cloud.execute("SELECT id, payload FROM workouts");
    const prior = (before.rows as unknown as { id: string; payload: string }[])
      .map((record) => json<Workout>(record.payload, { id: record.id, date: "", week: 0, session: "" }));
    const updated = preserveMatchedStatus(workbook, prior);
    const sql: { sql: string; args?: (string | number | null)[] }[] = [
      {
        sql: "INSERT OR IGNORE INTO workout_plan_backups (migration_key, workout_id, payload) SELECT ?, id, payload FROM workouts",
        args: [AUTHORITATIVE_PLAN_KEY],
      },
      { sql: "DELETE FROM workouts" },
      ...updated.map((item) => ({
        sql: "INSERT INTO workouts (id, payload) VALUES (?, ?)",
        args: [String(item.id), JSON.stringify(item)],
      })),
      {
        sql: "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
        args: [AUTHORITATIVE_PLAN_KEY, JSON.stringify("Replaced active Training Block with 115 workbook sessions; previous workouts archived.")],
      },
    ];
    await cloud.batch(sql, "write");
    return;
  }

  local!.exec("BEGIN IMMEDIATE");
  try {
    if (local!.prepare(markerSql).get(AUTHORITATIVE_PLAN_KEY)) {
      local!.exec("COMMIT");
      return;
    }
    const before = local!.prepare("SELECT id, payload FROM workouts").all() as { id: string; payload: string }[];
    const prior = before.map((record) => json<Workout>(record.payload, { id: record.id, date: "", week: 0, session: "" }));
    const updated = preserveMatchedStatus(workbook, prior);
    const backup = local!.prepare("INSERT OR IGNORE INTO workout_plan_backups (migration_key, workout_id, payload) VALUES (?, ?, ?)");
    for (const record of before) backup.run(AUTHORITATIVE_PLAN_KEY, record.id, record.payload);
    local!.prepare("DELETE FROM workouts").run();
    const insert = local!.prepare("INSERT INTO workouts (id, payload) VALUES (?, ?)");
    for (const item of updated) insert.run(String(item.id), JSON.stringify(item));
    local!.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(
      AUTHORITATIVE_PLAN_KEY,
      JSON.stringify("Replaced active Training Block with 115 workbook sessions; previous workouts archived."),
    );
    local!.exec("COMMIT");
  } catch (error) {
    local!.exec("ROLLBACK");
    throw error;
  }
}

function preserveMatchedStatus(next: Workout[], previous: Workout[]): Workout[] {
  const byId = new Map(previous.filter((item) => item.id != null).map((item) => [String(item.id), item]));
  const keyOf = (item: Workout) => {
    const day = (item.day || item.session.split(":")[0] || "").slice(0, 3).toLowerCase();
    return item.date + "|" + day + "|" + Boolean(item.strength);
  };
  const byDay = new Map<string, Workout>();
  for (const item of previous) {
    const key = keyOf(item);
    const prev = byDay.get(key);
    if (!prev || item.status === "completed" || (item.status === "cancelled" && prev.status !== "completed")) {
      byDay.set(key, item);
    }
  }
  return next.map((item) => {
    const previousEntry = byId.get(String(item.id)) ?? byDay.get(keyOf(item));
    if (previousEntry?.status === "completed" || previousEntry?.status === "cancelled") {
      // The new prescription always comes from the workbook; only status survives.
      return { ...item, status: previousEntry.status };
    }
    return item;
  });
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


/** Run-history conflicts must never be resolved by discarding server records. */
export class RunHistoryConflictError extends Error {
  constructor(message = "Run History has changed in another tab. Refresh before trying again; no runs were overwritten.") {
    super(message);
    this.name = "RunHistoryConflictError";
  }
}

function runPayload(run: Run): string {
  const { id: _id, ...payload } = run;
  return JSON.stringify(payload);
}
function runIdentity(run: Run): string {
  return [run.date, run.name, Number(run.distance || 0), Number(run.duration || 0)].join("|");
}

/**
 * Applies only the specific rows changed in a browser tab. A stale tab cannot
 * truncate the server's table or overwrite runs it never loaded. Before every
 * edited/deleted record, an append-only journal captures the previous payload.
 */
export async function updateRunHistorySafely(baseRuns: Run[], desiredRuns: Run[]): Promise<Bundle> {
  await ensureReady();
  if (!Array.isArray(baseRuns) || !Array.isArray(desiredRuns)) throw new RunHistoryConflictError("Run history snapshot missing. Refresh Stride and try again.");
  const base = new Map(baseRuns.filter(run => Number.isInteger(run.id) && Number(run.id) > 0).map(run => [Number(run.id), run]));
  const desired = new Map(desiredRuns.filter(run => Number.isInteger(run.id) && Number(run.id) > 0).map(run => [Number(run.id), run]));
  if (base.size !== baseRuns.length || desired.size !== desiredRuns.filter(run => run.id != null).length) {
    throw new RunHistoryConflictError("Run History contains ambiguous record IDs. No changes were saved.");
  }

  const operations: Array<{ action: "update" | "delete"; id: number; before: Run; after?: Run }> = [];
  for (const [id, before] of base) {
    const after = desired.get(id);
    if (!after) operations.push({ action: "delete", id, before });
    else if (runPayload(before) !== runPayload(after)) operations.push({ action: "update", id, before, after });
  }
  for (const id of desired.keys()) if (!base.has(id)) throw new RunHistoryConflictError("Unexpected run ID. Refresh before saving.");
  const additions = desiredRuns.filter(run => run.id == null);

  // Read current server state and validate the PREVIOUS version for each changed row.
  // None of the other run records are ever written or removed.
  const current = await getBundle();
  const currentById = new Map(current.runs.map(run => [Number(run.id), run]));
  for (const operation of operations) {
    const actual = currentById.get(operation.id);
    if (!actual || runPayload(actual) !== runPayload(operation.before)) throw new RunHistoryConflictError();
  }
  const identities = new Set(current.runs.map(runIdentity));
  const newRuns: Run[] = [];
  for (const run of additions) {
    if (!run.date || !run.name || !(Number(run.distance) > 0) || !(Number(run.duration) > 0)) {
      throw new RunHistoryConflictError("One run is incomplete. No records were saved.");
    }
    if (identities.has(runIdentity(run))) continue;
    identities.add(runIdentity(run));
    newRuns.push(run);
  }
  if (!operations.length && !newRuns.length) return current;

  if (cloud) {
    const statements: { sql: string; args?: (string | number | null)[] }[] = [];
    for (const operation of operations) {
      statements.push({
        sql: "INSERT INTO run_history_backups (run_id, payload, reason) SELECT id, payload, ? FROM runs WHERE id = ?",
        args: [operation.action, operation.id],
      });
      statements.push(operation.action === "delete"
        ? { sql: "DELETE FROM runs WHERE id = ? AND payload = ?", args: [operation.id, runPayload(operation.before)] }
        : { sql: "UPDATE runs SET payload = ? WHERE id = ? AND payload = ?", args: [runPayload(operation.after!), operation.id, runPayload(operation.before)] });
    }
    for (const run of newRuns) statements.push({ sql: "INSERT INTO runs (payload) VALUES (?)", args: [runPayload(run)] });
    await cloud.batch(statements, "write");
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      for (const operation of operations) {
        const actual = local!.prepare("SELECT payload FROM runs WHERE id = ?").get(operation.id) as { payload: string } | undefined;
        if (!actual || actual.payload !== runPayload(operation.before)) throw new RunHistoryConflictError();
        local!.prepare("INSERT INTO run_history_backups (run_id, payload, reason) VALUES (?, ?, ?)")
          .run(operation.id, actual.payload, operation.action);
        if (operation.action === "delete") local!.prepare("DELETE FROM runs WHERE id = ?").run(operation.id);
        else local!.prepare("UPDATE runs SET payload = ? WHERE id = ?").run(runPayload(operation.after!), operation.id);
      }
      const insert = local!.prepare("INSERT INTO runs (payload) VALUES (?)");
      for (const run of newRuns) insert.run(runPayload(run));
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }
  return getBundle();
}

/** Imports or recovers only missing runs without touching existing Run History. */
export async function appendRunHistorySafely(imported: Run[]): Promise<{ bundle: Bundle; added: number }> {
  const current = await getBundle();
  const identities = new Set(current.runs.map(runIdentity));
  const additions: Run[] = [];
  for (const run of imported) {
    if (!run.date || !run.name || !(Number(run.distance) > 0) || !(Number(run.duration) > 0)) continue;
    const key = runIdentity(run);
    if (identities.has(key)) continue;
    identities.add(key);
    additions.push({ ...run, id: undefined });
  }
  const bundle = await updateRunHistorySafely(current.runs, [...current.runs, ...additions]);
  return { bundle, added: additions.length };
}

export async function saveBundle(bundle: Partial<Bundle>): Promise<Bundle> {
  await ensureReady();
  if (bundle.runs) throw new RunHistoryConflictError("Bulk Run History replacements are disabled. Use the protected per-run operations.");
  if (!cloud) {
    local!.exec("BEGIN IMMEDIATE");
    try {
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
