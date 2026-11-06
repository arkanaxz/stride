import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const db=readFileSync("src/lib/database.ts","utf8");
const api=readFileSync("src/app/api/data/route.ts","utf8");
const dash=readFileSync("src/components/dashboard.tsx","utf8");
const weather=readFileSync("src/app/api/weather/route.ts","utf8");

test("live workout saving is a checked, interactive write transaction",()=>{
  const code=db.slice(db.indexOf("export async function completeWorkoutWithRunSafely"),db.indexOf("One-time targeted repair"));
  assert.match(code,/await cloud.transaction\("write"\)/);
  assert.match(code,/await tx.commit\(\)/);
  assert.match(code,/await tx.rollback\(\)/);
  assert.match(code,/tx.close\(\)/);
  assert.match(code,/UPDATE workouts SET payload = \? WHERE id = \? AND payload = \?/);
  assert.match(code,/INSERT INTO runs \(payload\) VALUES \(\?\) RETURNING id/);
  assert.match(code,/updated.rowsAffected !== 1/);
  assert.doesNotMatch(code,/run.date !== workout.date/);
  assert.doesNotMatch(code,/DELETE FROM runs|DELETE FROM workouts|saveBundle/);
});
test("errors appear INSIDE the run form, and save cannot double-submit",()=>{
  assert.match(dash,/runSaveInFlight\.current/);
  assert.match(dash,/setRunSaveError\(message\)/);
  assert.match(dash,/<p role="alert" className="notice error">\{runSaveError\}<\/p>/);
  assert.match(dash,/disabled=\{runSaving\}/);
  assert.match(dash,/Retry weather/);
  assert.match(api,/console.error\("\[Stride complete-workout\]"/);
});
test("weather never mixes incompatible API date options",()=>{
  assert.match(weather,/if \(useForecast\) \{/);
  assert.match(weather,/past_days"/);
  assert.match(weather,/start_date"/);
  const forecastSection=weather.slice(weather.indexOf("if (useForecast) {",weather.indexOf('const weatherUrl')),weather.indexOf("const weatherResponse"));
  assert.match(forecastSection,/else \{/);
  assert.match(forecastSection,/weatherUrl.searchParams.set\("start_date", date\)/);
  assert.match(forecastSection,/weatherUrl.searchParams.set\("past_days"/);
});
