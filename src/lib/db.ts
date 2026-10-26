import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";

const dbPath = path.resolve(process.env.STRIDE_DB_PATH || path.join(process.cwd(), "data", "stride.sqlite"));
mkdirSync(path.dirname(dbPath), { recursive: true });

const globalDb = globalThis as typeof globalThis & { strideDatabase?: DatabaseSync };
const db = globalDb.strideDatabase ?? new DatabaseSync(dbPath);
globalDb.strideDatabase = db;
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const defaultPreferences: Preferences = {
  defaultLocation: "Lapu-Lapu City, Cebu, Philippines",
  theme: "dark",
  raceDate: "2027-03-14",
  planRowCount: 1,
  provider: "openai",
  model: "gpt-6-luna",
};

function json<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function getBundle(): Bundle {
  const runs = db.prepare("SELECT id, payload FROM runs ORDER BY json_extract(payload, '$.date') DESC, id DESC").all() as { id: number; payload: string }[];
  const workouts = db.prepare("SELECT id, payload FROM workouts ORDER BY json_extract(payload, '$.date'), id").all() as { id: string; payload: string }[];
  const settings = Object.fromEntries((db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM metadata").all() as { key: string; value: string }[]).map((row) => [row.key, json(row.value, row.value)]));
  return {
    runs: runs.map((row) => ({ ...json<Run>(row.payload, {} as Run), id: row.id })),
    plan: workouts.map((row) => json<Workout>(row.payload, { id: row.id, date: "", week: 0, session: "" })),
    meta,
    preferences: { ...defaultPreferences, ...settings } as Preferences,
  };
}

export function saveBundle(bundle: Partial<Bundle>) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (bundle.runs) {
      db.exec("DELETE FROM runs");
      const insert = db.prepare("INSERT INTO runs (payload) VALUES (?)");
      const insertWithId = db.prepare("INSERT INTO runs (id, payload) VALUES (?, ?)");
      for (const run of bundle.runs) {
        const { id: _id, ...payload } = run;
        if (Number.isInteger(run.id) && Number(run.id) > 0) insertWithId.run(Number(run.id), JSON.stringify(payload));
        else insert.run(JSON.stringify(payload));
      }
    }
    if (bundle.plan) {
      db.exec("DELETE FROM workouts");
      const insert = db.prepare("INSERT INTO workouts (id, payload) VALUES (?, ?)");
      bundle.plan.forEach((workout, index) => insert.run(String(workout.id ?? `workout-${index}`), JSON.stringify(workout)));
    }
    if (bundle.preferences) {
      const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      for (const [key, value] of Object.entries(bundle.preferences)) upsert.run(key, JSON.stringify(value));
    }
    if (bundle.meta) {
      const upsert = db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      for (const [key, value] of Object.entries(bundle.meta)) upsert.run(key, JSON.stringify(value));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getBundle();
}

export function hasMigratedLegacyData() {
  return db.prepare("SELECT value FROM metadata WHERE key = 'legacy_imported'").get() !== undefined;
}

export function markLegacyDataMigrated() {
  db.prepare("INSERT INTO metadata (key, value) VALUES ('legacy_imported', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run();
}
