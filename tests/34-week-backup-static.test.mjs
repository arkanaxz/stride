import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const db = readFileSync("src/lib/database.ts","utf8");
const ui = readFileSync("src/components/dashboard.tsx","utf8");
const api = readFileSync("src/app/api/data/route.ts","utf8");
const backup = readFileSync("src/app/api/backup/34week/route.ts","utf8");
const migrate = db.slice(db.indexOf("export async function ensureSub2034WeekPlan"),db.indexOf("export async function exportPre34WeekSnapshot"));
test("snapshot and migration are one atomic transaction and contain no deletions",()=>{
  assert.match(migrate,/await cloud.batch\(sql, "write"\)/);
  assert.match(migrate,/BEGIN IMMEDIATE/);
  assert.match(migrate,/ROLLBACK/);
  assert.ok(migrate.indexOf("...backup") < migrate.indexOf("supersedeSql"));
  assert.doesNotMatch(migrate,/DELETE FROM runs|DELETE FROM workouts|DROP TABLE/);
  for(const table of ["runs","workouts","settings","metadata","users","secrets","run_comments","run_history_baseline","run_history_backups","workout_plan_backups"]){
    assert.ok(migrate.includes('table: "'+table+'"'),"missing "+table);
  }
  assert.match(migrate,/json_extract\(payload, '\$\.date'\) > \?/);
  assert.match(migrate,/!= 'completed'/);
});
test("UI hides archived workouts and allows admin-only full backup",()=>{
  assert.match(ui,/bundle.plan.filter\(\(workout\) => workout.status !== "superseded"\)/);
  assert.match(ui,/href="\/api\/backup\/34week"/);
  assert.match(ui,/changes.basePlan = bundle.plan/);
  assert.match(api,/JSON.stringify\(requestBody.basePlan\) !== JSON.stringify\(current.plan\)/);
  assert.match(backup,/user\?\.role !== "admin"/);
  assert.match(backup,/Cache-Control": "private, no-store"/);
});
