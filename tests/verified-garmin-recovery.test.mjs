import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { verifiedGarminRunSummaries } from "../src/lib/recovered-garmin-runs.ts";

const databaseCode = readFileSync("src/lib/database.ts", "utf8");
const start = databaseCode.indexOf("export async function ensureVerifiedGarminRunRecovery");
const end = databaseCode.indexOf("export async function getBundle", start);
const migration = databaseCode.slice(start, end);
const insertMatch = migration.match(/const insertIfMissing = "([^"]+)"/);

test("four independently verified Garmin summaries have correct metrics and distinguish incomplete recovery", () => {
  assert.equal(verifiedGarminRunSummaries.length, 4);
  const expected = [
    ["2026-10-29", 7.33, 44, 38, 166, 189],
    ["2026-10-30", 5.04, 36, 6, 146, 153],
    ["2026-11-03", 6.12, 45, 9, 137, 149],
    ["2026-11-04", 7.83, 53, 23, 152, 178],
  ];
  for (let i = 0; i < expected.length; i++) {
    const [date, distance, min, sec, hr, maxHr] = expected[i];
    const actual = verifiedGarminRunSummaries[i];
    assert.equal(actual.date, date);
    assert.equal(actual.distance, distance);
    assert.equal(Math.round(actual.duration * 60), min * 60 + sec);
    assert.equal(actual.avgHr, hr);
    assert.equal(actual.maxHr, maxHr);
    assert.equal(actual.recoveryStatus, "summary-only");
    assert.equal(actual.shoes, undefined);
    assert.equal(actual.sleep, undefined);
    assert.equal(actual.effort, undefined);
    assert.equal(actual.analysisHistory, undefined);
  }
});

test("recovery inserts only missing dates, preserves pre-existing run and is idempotent", () => {
  assert.ok(insertMatch, "recovery SQL must exist");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)");
  const previous = {
    date: "2026-10-30", name: "Original logged easy run",
    type: "Easy", distance: 5.04, duration: 36.1,
    avgHr: 146, maxHr: 153, notes: "Keep my original notes!"
  };
  db.prepare("INSERT INTO runs (payload) VALUES (?)").run(JSON.stringify(previous));
  const guardedInsert = db.prepare(insertMatch[1]);
  for (const run of verifiedGarminRunSummaries) guardedInsert.run(JSON.stringify(run), run.date);
  const rows = db.prepare("SELECT id, payload FROM runs ORDER BY id").all().map(row => JSON.parse(row.payload));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.find(row => row.date === "2026-10-30"), previous);
  assert.equal(rows.filter(row => row.recoveryStatus === "summary-only").length, 3);
  for (const run of verifiedGarminRunSummaries) guardedInsert.run(JSON.stringify(run), run.date);
  assert.equal(db.prepare("SELECT count(*) AS total FROM runs").get().total, 4);
  db.close();
});

test("recovery code is insert-only and never touches workouts, settings or other run rows", () => {
  assert.match(migration, /INSERT INTO runs \(payload\) SELECT \?/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /VERIFIED_GARMIN_RECOVERY_KEY/);
  assert.doesNotMatch(migration, /DELETE FROM runs|UPDATE runs|DELETE FROM workouts|saveBundle/);
  const dataRoute = readFileSync("src/app/api/data/route.ts", "utf8");
  const historyRoute = readFileSync("src/app/history/page.tsx", "utf8");
  assert.match(dataRoute, /await ensureVerifiedGarminRunRecovery\(\)/);
  assert.match(historyRoute, /await ensureVerifiedGarminRunRecovery\(\)/);
});
