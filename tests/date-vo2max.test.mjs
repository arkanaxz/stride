import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const types = read("src/lib/types.ts");
const history = read("src/components/run-history-table.tsx");
const fullHistory = read("src/components/run-history-page.tsx");
const dashboard = read("src/components/dashboard.tsx");
const trend = read("src/components/garmin-vo2max-trend.tsx");
const importer = read("src/app/api/import/route.ts");
const css = read("src/app/globals.css");

test("date is first even with previous user column selections", () => {
  const date = history.indexOf('{ key: "date", label: "Date"');
  const name = history.indexOf('{ key: "name", label: "Run"');
  assert.ok(date > 0 && name > date);
  assert.match(history, /const defaultKeys = \["date", "name"/);
  assert.match(history, /columns\.filter\(col => keys\.includes\(col\.key\)\)/);
});
test("Garmin VO2 max is optional in run entry, editing, history and CSV", () => {
  assert.match(types, /garminVo2Max\?: number \| null/);
  assert.match(dashboard, /name="garminVo2Max"/);
  assert.match(dashboard, /defaultValue=\{editingRun\?\.garminVo2Max \?\? ""\}/);
  assert.match(dashboard, /garminVo2Max: form\.get\("garminVo2Max"\)/);
  assert.match(dashboard, /garminVo2Max", "painDuring"/);
  assert.match(fullHistory, /"garminVo2Max"/);
  assert.match(importer, /garminVo2Max: numeric\(row\.garminVo2Max\)/);
  assert.match(history, /Garmin VO₂ Max/);
});
test("VO2 chart is read-only, dated and is correctly ordered in dashboard", () => {
  assert.match(trend, /const byDate = new Map<string, number>\(\)/);
  assert.match(trend, /garminVo2Max == null/);
  assert.match(trend, /mL\/kg\/min/);
  assert.doesNotMatch(trend, /fetch\(|saveBundle\(|localStorage\.setItem/);
  assert.match(dashboard, /<GarminVo2MaxTrend runs=\{bundle\.runs\}\/>/);
  assert.match(css, /\.shell>\.vo2-trend-card\{order:4/);
});
test("existing run fields are retained when edited", () => {
  assert.match(dashboard, /\{ \.\.\.editingRun, \.\.\.run, id: editingRun\.id/);
});
