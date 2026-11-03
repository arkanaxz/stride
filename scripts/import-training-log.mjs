import { createClient } from "@libsql/client";
import XLSX from "xlsx";

const input = process.argv[2];
if (!input) throw new Error("Usage: node --env-file=.env.local scripts/import-training-log.mjs <workbook.xlsx>");
const url = process.env.TURSO_DATABASE_URL || process.env.stride_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.stride_TURSO_AUTH_TOKEN;
if (!url || !authToken) throw new Error("Turso credentials are not configured in .env.local.");

const workbook = XLSX.readFile(input, { cellDates: true });
const sheet = workbook.Sheets["Training Log"];
if (!sheet) throw new Error("Workbook is missing the Training Log sheet.");
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
function cell(row, index) { return row[index] ?? ""; }
function text(value) { return String(value ?? "").trim(); }
function dateString(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== "number") return "";
  const parsed = XLSX.SSF.parse_date_code(value);
  return parsed?.y ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10) : "";
}
const plan = rows.slice(5).flatMap((row, index) => {
  const date = dateString(cell(row, 2));
  const type = text(cell(row, 4));
  const workout = text(cell(row, 5));
  if (!date || !type || /^(rest|strength)/i.test(type) || !workout) return [];
  const week = Number(cell(row, 0)) || 0;
  const day = text(cell(row, 3));
  const km = Number(cell(row, 6));
  const notes = [text(cell(row, 9)), text(cell(row, 16)) && `Logged notes: ${text(cell(row, 16))}`].filter(Boolean).join("\n\n");
  return [{
    id: `running-era-${date}-${week}-${day}-${index}`,
    week,
    phase: text(cell(row, 1)),
    day,
    date,
    session: `${type}: ${workout}`,
    target: Number.isFinite(km) && cell(row, 6) !== "" ? `${km} km · ${workout}` : workout,
    pace: text(cell(row, 7)),
    hr: text(cell(row, 8)),
    notes,
    status: /^yes$/i.test(text(cell(row, 10))) ? "completed" : "planned",
    dateShiftable: false,
  }];
});
if (!plan.length) throw new Error("No running workouts were found; the Turso plan was not changed.");

const db = createClient({ url, authToken });
try {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  ]) await db.execute(sql);
  const statements = [
    { sql: "DELETE FROM workouts" },
    ...plan.map((workout) => ({ sql: "INSERT INTO workouts (id, payload) VALUES (?, ?)", args: [workout.id, JSON.stringify(workout)] })),
    ...Object.entries({ raceDate: "2027-03-07", lthr: 179 }).map(([key, value]) => ({ sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, JSON.stringify(value)] })),
    ...Object.entries({ title: "SM2SM 2027 Half Marathon · Sub 1:45", raceDate: "2027-03-07", goalFinish: "1:44:59", goalPace: "4:58/km" }).map(([key, value]) => ({ sql: "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, JSON.stringify(value)] })),
  ];
  await db.batch(statements, "write");
  console.log(`Updated the training block with ${plan.length} running workouts; logged runs were preserved.`);
} finally {
  await db.close();
}
