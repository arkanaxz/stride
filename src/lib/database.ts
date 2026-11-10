import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";
import { STRENGTH_PLAN_SEED_KEY, strengthPlanWorkouts } from "@/lib/strength-plan";
import { AUTHORITATIVE_PLAN_KEY, authoritativeWorkouts } from "@/lib/sm2sm-workbook-plan";
import { VERIFIED_GARMIN_RECOVERY_KEY, verifiedGarminRunSummaries } from "@/lib/recovered-garmin-runs";
import { SUB20_34W_BACKUP_KEY, SUB20_34W_IMPORT_KEY, SUB20_34W_PRESERVE_THROUGH, SUB20_34W_TITLE, sub20Workouts } from "@/lib/sub20-34week-plan";

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
        "CREATE TABLE IF NOT EXISTS stride_backup_rows (snapshot_key TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, payload TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (snapshot_key, table_name, row_key))",
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


/**
 * One-time, non-destructive recovery of the four run summaries that can be
 * verified from prior Garmin analysis. It inserts a record only if NO run for
 * that calendar date exists. It never replaces or deletes an existing run.
 *
 * The date check and insert execute in the same SQL statement, inside a
 * transaction. Concurrent dashboard requests cannot create duplicates.
 * This does not pretend to restore missing manually entered fields.
 */
export async function ensureVerifiedGarminRunRecovery(): Promise<void> {
  await ensureReady();
  if (verifiedGarminRunSummaries.length !== 4 ||
      new Set(verifiedGarminRunSummaries.map(run => run.date)).size !== 4 ||
      verifiedGarminRunSummaries.some(run => !(run.distance > 0) || !(run.duration > 0))) {
    throw new Error("Verified Garmin recovery input failed validation; no database writes performed.");
  }
  const check = "SELECT key FROM metadata WHERE key = ? LIMIT 1";
  const insertIfMissing = "INSERT INTO runs (payload) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM runs WHERE json_extract(payload, '$.date') = ?)";
  const markerValue = JSON.stringify({
    source: "Previously analyzed Garmin workout summaries",
    dates: verifiedGarminRunSummaries.map(run => run.date),
    originalManualFields: "not available",
    restored: "date, distance, duration, avgHr, maxHr, workout context where verified",
  });

  if (cloud) {
    const applied = await cloud.execute({ sql: check, args: [VERIFIED_GARMIN_RECOVERY_KEY] });
    if (applied.rows.length) return;
    const sql = [
      ...verifiedGarminRunSummaries.map(run => ({
        sql: insertIfMissing,
        args: [JSON.stringify(run), run.date],
      })),
      {
        sql: "INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)",
        args: [VERIFIED_GARMIN_RECOVERY_KEY, markerValue],
      },
    ];
    await cloud.batch(sql, "write");
    return;
  }

  local!.exec("BEGIN IMMEDIATE");
  try {
    const applied = local!.prepare(check).get(VERIFIED_GARMIN_RECOVERY_KEY);
    if (!applied) {
      const insert = local!.prepare(insertIfMissing);
      for (const run of verifiedGarminRunSummaries) insert.run(JSON.stringify(run), run.date);
      local!.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)")
        .run(VERIFIED_GARMIN_RECOVERY_KEY, markerValue);
    }
    local!.exec("COMMIT");
  } catch (error) {
    local!.exec("ROLLBACK");
    throw error;
  }
}


/**
 * One-time non-destructive transition to the uploaded sub-20 34-week plan.
 *
 * BEFORE touching any planned workout, the SAME database transaction captures
 * full copies of runs (including reviews), workouts, preferences, metadata,
 * users, encrypted secrets, comments, baseline and historical backup journals.
 * A failure rolls back both snapshot and migration. No original row is deleted.
 *
 * Old future non-completed workouts become "superseded" with previousStatus
 * preserved inside their JSON payload. Nov 10 and earlier, and ALL completed
 * entries, remain unchanged. New IDs are unique and inserted only once.
 */
export async function ensureSub2034WeekPlan(): Promise<void> {
  await ensureReady();
  const imported = sub20Workouts(); // Check integrity/count before any database writes.
  const markerSql = "SELECT value FROM metadata WHERE key = ? LIMIT 1";
  const exists = cloud
    ? (await cloud.execute({ sql: markerSql, args: [SUB20_34W_IMPORT_KEY] })).rows.length > 0
    : Boolean(local!.prepare(markerSql).get(SUB20_34W_IMPORT_KEY));
  if (exists) return;

  const backupTables: Array<{ table: string; id: string; payload: string }> = [
    { table: "runs", id: "CAST(id AS TEXT)", payload: "json_object('id',id,'payload',payload)" },
    { table: "workouts", id: "id", payload: "json_object('id',id,'payload',payload)" },
    { table: "settings", id: "key", payload: "json_object('key',key,'value',value)" },
    { table: "metadata", id: "key", payload: "json_object('key',key,'value',value)" },
    { table: "users", id: "id", payload: "json_object('id',id,'username',username,'salt',salt,'password_hash',password_hash,'role',role)" },
    { table: "secrets", id: "key", payload: "json_object('key',key,'value',value)" },
    { table: "run_comments", id: "CAST(id AS TEXT)", payload: "json_object('id',id,'runId',run_id,'username',username,'text',text,'createdAt',created_at)" },
    { table: "run_history_baseline", id: "CAST(run_id AS TEXT)", payload: "json_object('run_id',run_id,'payload',payload,'captured_at',captured_at)" },
    { table: "run_history_backups", id: "CAST(backup_id AS TEXT)", payload: "json_object('backup_id',backup_id,'run_id',run_id,'payload',payload,'reason',reason,'captured_at',captured_at)" },
    { table: "workout_plan_backups", id: "migration_key || ':' || workout_id", payload: "json_object('migration_key',migration_key,'workout_id',workout_id,'payload',payload,'saved_at',saved_at)" },
  ];

  // A snapshot must be representable even if the database is brand-new and
  // every source table is empty. Preserve a manifest in the same transaction
  // BEFORE copying rows or modifying any workout.
  const tableCountsSql = "json_object(" + backupTables.map(source =>
    "'" + source.table + "', (SELECT COUNT(*) FROM " + source.table + ")"
  ).join(", ") + ")";
  const backupManifest = {
    sql: "INSERT OR IGNORE INTO stride_backup_rows (snapshot_key, table_name, row_key, payload) " +
      "SELECT ?, 'manifest', '__snapshot', json_object(" +
      "'version', 1, 'source', 'before-sub20-34week-plan', 'rowCounts', " + tableCountsSql + ") " +
      "WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key = ?)",
    args: [SUB20_34W_BACKUP_KEY, SUB20_34W_IMPORT_KEY],
  };
  const backup = backupTables.map(source => ({
    sql: "INSERT OR IGNORE INTO stride_backup_rows (snapshot_key, table_name, row_key, payload) " +
      "SELECT ?, ?, " + source.id + ", " + source.payload +
      " FROM " + source.table +
      " WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key = ?)",
    args: [SUB20_34W_BACKUP_KEY, source.table, SUB20_34W_IMPORT_KEY],
  }));
  const supersedeSql =
    "UPDATE workouts SET payload = json_set(payload, '$.previousStatus', " +
    "COALESCE(json_extract(payload, '$.status'), 'planned'), '$.status', 'superseded', " +
    "'$.supersededBy', ?) " +
    "WHERE json_extract(payload, '$.date') > ? " +
    "AND COALESCE(json_extract(payload, '$.status'), 'planned') != 'completed' " +
    "AND id NOT LIKE 'sub20-34w-%' " +
    "AND NOT EXISTS (SELECT 1 FROM metadata WHERE key = ?)";
  const sourceRows = JSON.stringify(imported.map(row => [String(row.id), JSON.stringify(row)]));
  const insertSql =
    "INSERT INTO workouts(id,payload) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') " +
    "FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key = ?) " +
    "ON CONFLICT(id) DO NOTHING";
  const titleSql =
    "INSERT INTO metadata(key,value) SELECT 'title', ? " +
    "WHERE NOT EXISTS (SELECT 1 FROM metadata WHERE key = ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  const markerValue = JSON.stringify({
    importedFrom: ["34-Week Plan", "Strength A and B"],
    preservedThrough: SUB20_34W_PRESERVE_THROUGH,
    newWorkouts: imported.length,
    backupSnapshot: SUB20_34W_BACKUP_KEY,
    oldWorkouts: "retained in workouts with status superseded",
  });
  const markerInsert = "INSERT INTO metadata(key,value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING";
  const sql: { sql: string; args: (string | number | null)[] }[] = [
    backupManifest,
    ...backup,
    { sql: supersedeSql, args: [SUB20_34W_IMPORT_KEY, SUB20_34W_PRESERVE_THROUGH, SUB20_34W_IMPORT_KEY] },
    { sql: insertSql, args: [sourceRows, SUB20_34W_IMPORT_KEY] },
    { sql: titleSql, args: [JSON.stringify(SUB20_34W_TITLE), SUB20_34W_IMPORT_KEY] },
    { sql: markerInsert, args: [SUB20_34W_IMPORT_KEY, markerValue] },
  ];
  if (cloud) {
    await cloud.batch(sql, "write");
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of sql) local!.prepare(statement.sql).run(...statement.args);
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }

  const verification = cloud
    ? await cloud.execute({
      sql: "SELECT COUNT(*) AS n FROM stride_backup_rows WHERE snapshot_key = ?",
      args: [SUB20_34W_BACKUP_KEY],
    })
    : { rows: [local!.prepare("SELECT COUNT(*) AS n FROM stride_backup_rows WHERE snapshot_key = ?").get(SUB20_34W_BACKUP_KEY)] };
  if (Number(verification.rows[0]?.n) < 1) throw new Error("Pre-update backup was not verified; do not continue.");
}


/**
 * Recovery-point operations. Database-only snapshots are stored in
 * stride_backup_rows, with an independent download for safe offsite storage.
 * This does not capture Vercel's environment variables.
 */
const RECOVERY_SOURCES: ReadonlyArray<{ table: string; id: string; payload: string }> = [
  { table: "runs", id: "CAST(id AS TEXT)", payload: "json_object('id',id,'payload',payload)" },
  { table: "workouts", id: "id", payload: "json_object('id',id,'payload',payload)" },
  { table: "settings", id: "key", payload: "json_object('key',key,'value',value)" },
  { table: "metadata", id: "key", payload: "json_object('key',key,'value',value)" },
  { table: "users", id: "id", payload: "json_object('id',id,'username',username,'salt',salt,'password_hash',password_hash,'role',role)" },
  { table: "secrets", id: "key", payload: "json_object('key',key,'value',value)" },
  { table: "run_comments", id: "CAST(id AS TEXT)", payload: "json_object('id',id,'runId',run_id,'username',username,'text',text,'createdAt',created_at)" },
  { table: "run_history_baseline", id: "CAST(run_id AS TEXT)", payload: "json_object('run_id',run_id,'payload',payload,'captured_at',captured_at)" },
  { table: "run_history_backups", id: "CAST(backup_id AS TEXT)", payload: "json_object('backup_id',backup_id,'run_id',run_id,'payload',payload,'reason',reason,'captured_at',captured_at)" },
  { table: "workout_plan_backups", id: "migration_key || ':' || workout_id", payload: "json_object('migration_key',migration_key,'workout_id',workout_id,'payload',payload,'saved_at',saved_at)" },
];

export type RecoveryPoint = {
  id: string;
  label: string;
  createdAt: string;
  kind: "pre-import" | "manual" | "before-restore";
  runs: number;
  workouts: number;
  totalRows: number;
};

function recoveryKeyValid(key: string) {
  return /^(before_sub20_34week_20261110_v1|stride_recovery_[0-9a-f-]{36})$/.test(key);
}

function recoverableSnapshotStatements(
  key: string,
  label: string,
  kind: "manual" | "before-restore",
): Array<{ sql: string; args: (string | number | null)[] }> {
  const details = JSON.stringify({ label, kind, createdAt: new Date().toISOString(), format: "stride-database-snapshot-v2" });
  const rows = RECOVERY_SOURCES.map(source => ({
    sql: "INSERT INTO stride_backup_rows (snapshot_key, table_name, row_key, payload) " +
      "SELECT ?, ?, " + source.id + ", " + source.payload + " FROM " + source.table,
    args: [key, source.table] as (string | number | null)[],
  }));
  return [
    { sql: "INSERT INTO stride_backup_rows (snapshot_key, table_name, row_key, payload) VALUES (?, 'manifest', '__snapshot', ?)", args: [key, details] },
    ...rows,
  ];
}

function manilaToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value || "").join("-");
}

export async function listRecoveryPoints(): Promise<RecoveryPoint[]> {
  await ensureReady();
  const query = "SELECT snapshot_key, MIN(captured_at) AS created_at, " +
    "SUM(CASE WHEN table_name = 'runs' THEN 1 ELSE 0 END) AS runs, " +
    "SUM(CASE WHEN table_name = 'workouts' THEN 1 ELSE 0 END) AS workouts, " +
    "COUNT(*) AS total_rows, " +
    "MAX(CASE WHEN table_name = 'manifest' THEN payload ELSE NULL END) AS manifest " +
    "FROM stride_backup_rows GROUP BY snapshot_key ORDER BY created_at DESC, snapshot_key DESC";
  const rows = cloud ? (await cloud.execute(query)).rows : local!.prepare(query).all();
  return rows.map(row => {
    const id = String(row.snapshot_key);
    const fallback = id === SUB20_34W_BACKUP_KEY ? "Before 34-week plan import" : "Stride recovery point";
    const parsed = row.manifest ? json<{ label?: string; kind?: RecoveryPoint["kind"]; createdAt?: string }>(String(row.manifest), {}) : {};
    return {
      id,
      label: parsed.label || fallback,
      createdAt: parsed.createdAt || String(row.created_at || ""),
      kind: (parsed.kind === "manual" || parsed.kind === "before-restore" ? parsed.kind : "pre-import") as RecoveryPoint["kind"],
      runs: Number(row.runs || 0),
      workouts: Number(row.workouts || 0),
      totalRows: Number(row.total_rows || 0),
    };
  }).filter(row => recoveryKeyValid(row.id));
}

export async function createRecoveryPoint(label = "Manual backup"): Promise<RecoveryPoint> {
  await ensureReady();
  const key = "stride_recovery_" + randomUUID();
  const statements = recoverableSnapshotStatements(key, label.trim().slice(0, 80) || "Manual backup", "manual");
  if (cloud) {
    await cloud.batch(statements, "write");
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) local!.prepare(statement.sql).run(...statement.args);
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }
  const summary = (await listRecoveryPoints()).find(row => row.id === key);
  if (!summary || summary.totalRows < 1) throw new Error("Recovery point could not be verified.");
  return summary;
}

export async function exportRecoveryPoint(key: string) {
  if (!recoveryKeyValid(key)) return null;
  await ensureReady();
  const query = { sql: "SELECT table_name, row_key, payload, captured_at FROM stride_backup_rows WHERE snapshot_key = ? ORDER BY table_name, row_key", args: [key] };
  const rows = cloud ? (await cloud.execute(query)).rows : local!.prepare(query.sql).all(...query.args);
  if (!rows.length) return null;
  const tables: Record<string, unknown[]> = {};
  for (const row of rows) {
    const table = String(row.table_name);
    if (!tables[table]) tables[table] = [];
    tables[table].push(JSON.parse(String(row.payload)));
  }
  return {
    format: "stride-database-recovery-export-v2",
    snapshotKey: key,
    capturedAt: String(rows[0].captured_at),
    containsSensitiveCredentials: true,
    notice: "Private backup. Includes account credential hashes, encrypted API keys, and recorded runs. Environment variables are NOT included.",
    includes: Object.fromEntries(Object.entries(tables).map(([name, data]) => [name, data.length])),
    tables,
  };
}

/**
 * Recover only the selected snapshot's future Training Block prescriptions.
 *
 * A full database rollback would destroy newly logged runs, so we NEVER
 * restore the runs, secrets, settings or accounts as part of this action.
 *
 * Existing runs, today/past workouts and completed workouts are unchanged.
 * Workouts absent from the chosen plan are ARCHIVED with status superseded,
 * not deleted. Backup of all current tables is stored in the SAME transaction.
 */
export async function restoreFuturePlanFromRecoveryPoint(key: string):
  Promise<{ beforeRestoreKey: string; restored: number; archived: number }> {
  if (!recoveryKeyValid(key)) throw new RunHistoryConflictError("Invalid recovery point.");
  await ensureReady();
  const selected = await exportRecoveryPoint(key);
  const savedRows = selected?.tables.workouts as Array<{ id?: string; payload?: string }> | undefined;
  if (!selected || !Array.isArray(savedRows) || !savedRows.length) {
    throw new RunHistoryConflictError("Selected backup has no Training Block data to restore.");
  }
  const today = manilaToday();
  const saved = new Map<string, { record: Workout; payload: string }>();
  for (const row of savedRows) {
    if (typeof row.id !== "string" || typeof row.payload !== "string") {
      throw new RunHistoryConflictError("Invalid workout record in backup; nothing was changed.");
    }
    const record = json<Workout>(row.payload, {} as Workout);
    if (record.date && record.date > today) saved.set(row.id, { record, payload: row.payload });
  }
  if (!saved.size) throw new RunHistoryConflictError("This backup has no future workouts to restore.");
  const current = await getBundle();
  const currentById = new Map(current.plan.map(item => [String(item.id), item]));
  const sql: Array<{ sql: string; args: (string | number | null)[] }> = [];
  let archived = 0, restored = 0;
  for (const workout of current.plan) {
    const id = String(workout.id);
    if (workout.date <= today || saved.has(id) || workout.status === "completed" || workout.status === "superseded") continue;
    sql.push({
      sql: "UPDATE workouts SET payload = ? WHERE id = ? AND payload = ?",
      args: [JSON.stringify({ ...workout, previousStatus: workout.status || "planned", status: "superseded", supersededBy: "restore:" + key }), id, JSON.stringify(workout)],
    });
    archived++;
  }
  for (const [id, entry] of saved) {
    const existing = currentById.get(id);
    if (existing?.status === "completed" || existing?.status === "cancelled") continue;
    if (existing) {
      // A current completed/cancelled choice always wins over stale snapshot status.
      if (JSON.stringify(existing) === entry.payload) continue;
      sql.push({ sql: "UPDATE workouts SET payload = ? WHERE id = ? AND payload = ?", args: [entry.payload, id, JSON.stringify(existing)] });
    } else {
      sql.push({ sql: "INSERT OR IGNORE INTO workouts (id, payload) VALUES (?, ?)", args: [id, entry.payload] });
    }
    restored++;
  }
  if (!sql.length) throw new RunHistoryConflictError("No future Training Block changes are necessary for this backup.");
  const titleRecord = (selected.tables.metadata as Array<{ key?: string; value?: string }> | undefined)?.find(item => item.key === "title");
  if (typeof titleRecord?.value === "string") {
    sql.push({ sql: "INSERT INTO metadata (key, value) VALUES ('title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [titleRecord.value] });
  }
  const beforeRestoreKey = "stride_recovery_" + randomUUID();
  const backup = recoverableSnapshotStatements(beforeRestoreKey, "Automatic backup before plan restore", "before-restore");
  // No DELETE or DROP statements; all current rows and the recovery point
  // are retained. A failed SQL statement rolls back the whole transaction.
  const statements = [...backup, ...sql];
  if (cloud) {
    await cloud.batch(statements, "write");
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) local!.prepare(statement.sql).run(...statement.args);
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }
  const verify = await listRecoveryPoints();
  if (!verify.some(point => point.id === beforeRestoreKey)) {
    throw new Error("Pre-restore backup not found; refresh before making other changes.");
  }
  return { beforeRestoreKey, restored, archived };
}

/** Admin-only export of the pre-import snapshot; treat this file as sensitive. */
export async function exportPre34WeekSnapshot() {
  await ensureReady();
  const statement = {
    sql: "SELECT table_name, row_key, payload, captured_at FROM stride_backup_rows WHERE snapshot_key = ? ORDER BY table_name, row_key",
    args: [SUB20_34W_BACKUP_KEY],
  };
  const rows = cloud
    ? (await cloud.execute(statement)).rows
    : local!.prepare(statement.sql).all(...statement.args);
  if (!rows.length) return null;
  const tables: Record<string, unknown[]> = {};
  for (const row of rows) {
    const table = String(row.table_name);
    if (!tables[table]) tables[table] = [];
    tables[table].push(JSON.parse(String(row.payload)));
  }
  return {
    format: "stride-complete-pre-migration-snapshot-v1",
    snapshotKey: SUB20_34W_BACKUP_KEY,
    containsSensitiveCredentials: true,
    instruction: "Private backup: contains account password hashes and encrypted API keys. Do not share publicly.",
    includes: Object.fromEntries(Object.entries(tables).map(([name, values]) => [name, values.length])),
    capturedAt: String(rows[0].captured_at),
    tables,
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

/** Save a completed workout and its associated run in the SAME transaction. */
export async function completeWorkoutWithRunSafely(
  workoutId: string,
  run: Run,
): Promise<{ bundle: Bundle; runId: number; inserted: boolean }> {
  await ensureReady();
  if (!workoutId || typeof workoutId !== "string" || workoutId.length > 160) {
    throw new RunHistoryConflictError("Missing planned workout. Refresh Stride and try again.");
  }
  if (!run || !run.date || !run.name?.trim() ||
      !Number.isFinite(Number(run.distance)) || !Number.isFinite(Number(run.duration)) ||
      !(Number(run.distance) > 0) || !(Number(run.duration) > 0)) {
    throw new RunHistoryConflictError("Enter a valid run date, name, distance and duration before saving.");
  }
  // The actual run date may differ from its planned date. Completion is linked
  // by the stable workout ID rather than requiring the two dates to match.
  const before = await getBundle();
  const workout = before.plan.find(item => String(item.id) === workoutId);
  if (!workout || workout.strength) throw new RunHistoryConflictError("Planned running workout not found. Refresh Stride.");
  if (workout.status === "cancelled") throw new RunHistoryConflictError("Restore the cancelled workout before logging it.");
  const matches = before.runs.filter(item => item.recoveryStatus !== "summary-only" &&
    (item.linkedWorkoutId === workoutId || (item.date === run.date && item.name === run.name)));
  if (matches.length > 1) throw new RunHistoryConflictError("Multiple matching runs were found. No changes were made.");
  const existing = matches[0];
  if (workout.status === "completed") {
    if (!existing?.id) throw new RunHistoryConflictError("That workout is already Completed. Refresh Stride.");
    return { bundle: before, runId: existing.id, inserted: false };
  }
  if (workout.status && workout.status !== "planned") throw new RunHistoryConflictError("Workout status changed. Refresh Stride.");

  const originalWorkoutPayload = JSON.stringify(workout);
  const updatedWorkoutPayload = JSON.stringify({ ...workout, status: "completed" });
  const insertSql = [
    "INSERT INTO runs (payload) SELECT ?",
    "WHERE EXISTS (SELECT 1 FROM workouts WHERE id = ? AND payload = ?)",
    "AND NOT EXISTS (SELECT 1 FROM runs WHERE",
    "COALESCE(json_extract(payload, '$.recoveryStatus'), '') <> 'summary-only' AND",
    "(json_extract(payload, '$.linkedWorkoutId') = ? OR",
    "(json_extract(payload, '$.date') = ? AND json_extract(payload, '$.name') = ?)))",
  ].join(" ");
  const insertArgs: (string | number | null)[] = [
    runPayload({ ...run, linkedWorkoutId: workoutId }),
    workoutId, originalWorkoutPayload, workoutId, run.date, run.name,
  ];
  const completeSql = "UPDATE workouts SET payload = ? WHERE id = ? AND payload = ?";
  const completeArgs: (string | number | null)[] = [updatedWorkoutPayload, workoutId, originalWorkoutPayload];

  let inserted = false;
  if (cloud) {
    // Turso SDK batch(write) provides one atomic transaction, including on
    // HTTP connections. Both operations use the SAME prior-workout guard:
    // a concurrently changed workout can neither insert a run nor be completed.
    const statements: { sql: string; args: (string | number | null)[] }[] = [
      ...(!existing ? [{ sql: insertSql, args: insertArgs }] : []),
      { sql: completeSql, args: completeArgs },
    ];
    const results = await cloud.batch(statements, "write");
    if (results.at(-1)?.rowsAffected !== 1) {
      throw new RunHistoryConflictError("The planned workout changed during save. Refresh Stride and retry.");
    }
    inserted = !existing && results[0]?.rowsAffected === 1;
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      let insertCount = 0;
      if (!existing) insertCount = Number(local!.prepare(insertSql).run(...insertArgs).changes);
      const changed = local!.prepare(completeSql).run(...completeArgs);
      if (changed.changes !== 1) {
        throw new RunHistoryConflictError("The planned workout changed during save. No run was added.");
      }
      local!.exec("COMMIT");
      inserted = insertCount === 1;
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }
  const saved = await getBundle();
  const recorded = saved.runs.find(item => item.linkedWorkoutId === workoutId) ||
    saved.runs.find(item => item.recoveryStatus !== "summary-only" && item.date === run.date && item.name === run.name);
  if (saved.plan.find(item => String(item.id) === workoutId)?.status !== "completed" || !recorded?.id) {
    throw new RunHistoryConflictError("Could not verify both saved run and completed workout. Refresh Stride.");
  }
  return { bundle: saved, runId: recorded.id, inserted };
}

/**
 * One-time targeted repair for the reported 2026-11-03 Log-as-done partial
 * save. It never creates/deletes a run or rewrites the training block.
 * An audit marker ensures an intentional later Undo is respected.
 */
export async function reconcileNov3WorkoutCompletion(): Promise<void> {
  await ensureReady();
  const workoutId = "sm2sm-2027-gm-2026-11-03-tue";
  const markerKey = "repair_log_as_done_20261103_v1";
  const snapshot = await getBundle();
  if (snapshot.meta[markerKey]) return;
  const workout = snapshot.plan.find(item => String(item.id) === workoutId);
  if (!workout || workout.strength || !["planned", "completed"].includes(workout.status || "planned")) return;
  if (snapshot.plan.filter(item => item.date === "2026-11-03" && !item.strength).length !== 1) return;
  const candidates = snapshot.runs.filter(item =>
    item.date === "2026-11-03" && item.recoveryStatus !== "summary-only" &&
    Number(item.distance) > 0 && Number(item.duration) > 0 && item.id != null
  );
  const exact = candidates.filter(item => item.linkedWorkoutId === workoutId || item.name.trim() === workout.session.trim());
  const matched = exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 ? candidates[0] : null;
  if (!matched?.id) return;
  const updateSql = "UPDATE workouts SET payload = json_set(payload, '$.status', 'completed') " +
    "WHERE id = ? AND COALESCE(json_extract(payload, '$.status'), 'planned') = 'planned'";
  const auditValue = JSON.stringify({ date: "2026-11-03", workoutId, runId: matched.id, reason: "Existing logged run not reflected in Training Block" });
  const auditSql = "INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)";
  if (cloud) {
    await cloud.batch([
      { sql: updateSql, args: [workoutId] },
      { sql: auditSql, args: [markerKey, auditValue] },
    ], "write");
  } else {
    local!.exec("BEGIN IMMEDIATE");
    try {
      local!.prepare(updateSql).run(workoutId);
      local!.prepare(auditSql).run(markerKey, auditValue);
      local!.exec("COMMIT");
    } catch (error) {
      local!.exec("ROLLBACK");
      throw error;
    }
  }
}

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
