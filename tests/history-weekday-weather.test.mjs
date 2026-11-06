import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const history = readFileSync("src/components/run-history-table.tsx", "utf8");
const dashboard = readFileSync("src/components/dashboard.tsx", "utf8");
const weather = readFileSync("src/app/api/weather/route.ts", "utf8");
test("Run History Date has weekday below ISO date and remains the first column", () => {
  assert.ok(history.indexOf('{ key: "date"') < history.indexOf('{ key: "name"'));
  assert.match(history, /weekdayForRunDate\(run.date\)/);
  assert.match(history, /weekday: "long"/);
  assert.match(history, /className="table-sub"/);
});
test("Pre-filled location and start time trigger weather without needing end time", () => {
  assert.match(dashboard, /ref=\{runFormRef\}/);
  assert.match(dashboard, /if \(!location \|\| !date \|\| !startTime\) return/);
  assert.match(dashboard, /void fillWeather\(form, true\)/);
  assert.match(dashboard, /\(!onlyMissing \|\| !weatherStart.value.trim\(\)\)/);
  assert.match(weather, /if \(!location \|\|/);
  assert.match(weather, /\(endTime &&/);
});
test("Weather API supports full saved location and recent hourly temperatures", () => {
  assert.match(weather, /Lapu-Lapu City/);
  assert.match(weather, /latitude: 10.31028, longitude: 123.94944/);
  assert.match(weather, /past_days/);
  assert.match(weather, /archive-api.open-meteo.com/);
  assert.doesNotMatch(weather, /saveBundle|UPDATE runs|DELETE FROM runs/);
});
