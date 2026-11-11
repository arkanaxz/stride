import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("src/components/dashboard.tsx","utf8");
const form = readFileSync("src/components/strength-log-modal.tsx","utf8");
const database = readFileSync("src/lib/database.ts","utf8");
const api = readFileSync("src/app/api/strength-log/route.ts","utf8");
const types = readFileSync("src/lib/types.ts","utf8");

test("Dashboard link changes URL from /settings back to / so reload keeps Dashboard",()=>{
  assert.match(dashboard, /href="\/">Dashboard<\/a>/);
  assert.match(dashboard, /className="brand" href="\/"/);
  assert.doesNotMatch(dashboard, /onClick=\{\(\) => setPage\("dashboard"\)\}/);
});
test("strength Log as done opens its own form; finished strength stays accessible",()=>{
  assert.match(dashboard,/else if \(workout\.strength\) \{ setStrengthLogWorkout\(workout\)/);
  assert.match(dashboard,/Strength workout history/);
  assert.match(dashboard,/workout\.status === "completed" \|\| workout\.strengthLog/);
  const history = readFileSync("src/components/strength-history-table.tsx", "utf8");
  assert.match(history,/w\.strengthLog \? "View \/ edit details" : "Add workout details"/);
  assert.match(dashboard,/<StrengthLogModal/);
});
test("strength fields match run logging with requested exclusions and detailed exercises",()=>{
  for(const field of ["location","date","name","type","durationHours","durationMinutes","durationSeconds",
    "avgHr","maxHr","sleepHours","sleepMinutes","rpe","painDuring","painNext","startTime","endTime","weatherDuring","exercises","notes"]){
    assert.match(form,new RegExp('name="'+field+'"'),"missing "+field);
  }
  for(const field of ["distance","garminVo2Max","effort","shoes","weatherStart","weatherEnd"]){
    assert.ok(!form.includes('name="'+field+'"'),"Excluded field should not be a strength input: "+field);
  }
  assert.doesNotMatch(form,/Calculated pace|Relative effort|Temperature at/);
  assert.match(types,/strengthLog\?: StrengthLog/);
});
test("targeted strength write never touches running records or shoe mileage",()=>{
  const start=database.indexOf("export async function saveStrengthWorkoutLog(");
  const end=database.indexOf("export async function completeWorkoutWithRunSafely(",start);
  assert.ok(start>=0&&end>start);
  const code=database.slice(start,end);
  assert.match(code,/UPDATE workouts SET payload = \? WHERE id = \? AND payload = \?/);
  assert.match(code,/workout\.status === "cancelled" \|\| workout\.status === "superseded"/);
  assert.match(code,/status: "completed", strengthLog: clean/);
  assert.match(code,/workout\.strength/);
  assert.match(code,/local!\.exec\("ROLLBACK"\)/);
  assert.doesNotMatch(code,/INSERT INTO runs|UPDATE runs|DELETE FROM runs|DELETE FROM workouts|saveBundle/);
  assert.match(api,/user\?\.role !== "admin"/);
  assert.ok(!api.includes("INSERT INTO runs"));
});
