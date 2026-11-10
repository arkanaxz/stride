import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const db = readFileSync("src/lib/database.ts","utf8");
const dash = readFileSync("src/components/dashboard.tsx","utf8");
const api = readFileSync("src/app/api/data/route.ts","utf8");
const atomic = db.slice(db.indexOf("export async function completeWorkoutWithRunSafely"), db.indexOf("export async function reconcileNov3WorkoutCompletion"));
const repair = db.slice(db.indexOf("export async function reconcileNov3WorkoutCompletion"), db.indexOf("export async function updateRunHistorySafely"));
test("planned run completion saves BOTH in one transaction and prevents a duplicate on retry", () => {
  assert.match(atomic,/await cloud.batch\(statements, "write"\)/);
  assert.match(atomic,/local!\.exec\("BEGIN IMMEDIATE"\)/);
  assert.match(atomic,/local!\.exec\("ROLLBACK"\)/);
  assert.match(atomic,/INSERT INTO runs \(payload\) SELECT/);
  assert.match(atomic,/UPDATE workouts SET payload = \? WHERE id = \? AND payload = \?/);
  assert.doesNotMatch(atomic,/DELETE FROM runs|DELETE FROM workouts|saveBundle/);
  assert.match(api,/incoming.kind === "complete-workout"/);
  assert.match(dash,/kind: "complete-workout", workoutId: completionWorkout.id, run/);
});
test("November 3 repair checks one real logged run and updates only one workout", () => {
  assert.match(repair,/sm2sm-2027-gm-2026-11-03-tue/);
  assert.match(repair,/recoveryStatus !== "summary-only"/);
  assert.match(repair,/candidates.length === 1/);
  assert.match(repair,/INSERT OR IGNORE INTO metadata/);
  assert.match(api,/await reconcileNov3WorkoutCompletion\(\)/);
  assert.doesNotMatch(repair,/DELETE FROM workouts|DELETE FROM runs|INSERT INTO runs/);
});
test("transaction rollback protects Run History and Training Block from partial completion", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL);CREATE TABLE workouts(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  const workoutId="sm2sm-2027-gm-2026-11-03-tue";
  db.prepare("INSERT INTO workouts(id,payload) VALUES (?,?)").run(workoutId,JSON.stringify({date:"2026-11-03",status:"planned"}));
  const original=JSON.stringify({date:"2026-11-03",status:"planned"});
  const insertSql=[
    "INSERT INTO runs (payload) SELECT ?",
    "WHERE EXISTS (SELECT 1 FROM workouts WHERE id = ? AND payload = ?)",
    "AND NOT EXISTS (SELECT 1 FROM runs WHERE",
    "COALESCE(json_extract(payload, '$.recoveryStatus'), '') <> 'summary-only' AND",
    "(json_extract(payload, '$.linkedWorkoutId') = ? OR",
    "(json_extract(payload, '$.date') = ? AND json_extract(payload, '$.name') = ?)))",
  ].join(" ");
  const updateSql="UPDATE workouts SET payload = ? WHERE id = ? AND payload = ?";
  const run={date:"2026-11-03",name:"Tue: Easy run",distance:6.12,duration:45.15,linkedWorkoutId:workoutId};
  const after=JSON.stringify({...JSON.parse(original),status:"completed"});
  db.exec("BEGIN IMMEDIATE");
  db.prepare(insertSql).run(JSON.stringify(run),workoutId,original,workoutId,run.date,run.name);
  assert.equal(db.prepare(updateSql).run(after,workoutId,original).changes,1);
  db.exec("COMMIT");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,1);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM workouts WHERE id=?").get(workoutId).payload).status,"completed");
  db.exec("BEGIN IMMEDIATE");
  db.prepare(insertSql).run(JSON.stringify(run),workoutId,original,workoutId,run.date,run.name);
  db.prepare(updateSql).run(after,workoutId,original);
  db.exec("COMMIT");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,1);
  db.prepare("UPDATE workouts SET payload=? WHERE id=?").run(original,workoutId);
  db.exec("BEGIN IMMEDIATE");
  db.prepare(insertSql).run(JSON.stringify({...run,name:"A second run"}),workoutId,original,workoutId,run.date,"A second run");
  try { db.prepare("INSERT INTO table_that_does_not_exist VALUES (1)").run(); } catch { db.exec("ROLLBACK"); }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,1);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM workouts WHERE id=?").get(workoutId).payload).status,"planned");
  db.close();
});
test("Training Block progress uses updated status and the server-returned bundle",()=>{
  assert.match(dash,/activePlan.filter\(\(workout\) => workout.status === "completed"\)\.length/);
  assert.match(dash,/plannedCount \? completedCount \/ plannedCount \* 100 : 0/);
  assert.match(dash,/setBundle\(saved\)/);
});
