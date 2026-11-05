import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const db = readFileSync("src/lib/database.ts","utf8");
const data = readFileSync("src/app/api/data/route.ts","utf8");
const analyze = readFileSync("src/app/api/analyze/route.ts","utf8");
const imported = readFileSync("src/app/api/import/route.ts","utf8");
const dashboard = readFileSync("src/components/dashboard.tsx","utf8");

test("all full-history replacements are rejected at the database layer", () => {
  assert.match(db,/if \(bundle\.runs\) throw new RunHistoryConflictError/);
  assert.match(db,/run_history_baseline/);
  assert.match(db,/run_history_backups/);
});

test("data PUT refuses stale clients and updates only changed run rows", () => {
  assert.match(data,/Array\.isArray\(requestBody\.baseRuns\)/);
  assert.match(data,/updateRunHistorySafely\(requestBody\.baseRuns, requestBody\.runs/);
  assert.match(dashboard,/changes\.baseRuns = bundle\.runs/);
  assert.match(db,/UPDATE runs SET payload = \? WHERE id = \? AND payload = \?/);
  assert.match(db,/INSERT INTO run_history_backups/);
  const safe = db.slice(db.indexOf("export async function updateRunHistorySafely"),db.indexOf("export async function appendRunHistorySafely"));
  assert.doesNotMatch(safe,/DELETE FROM runs"/);
  assert.match(safe,/DELETE FROM runs WHERE id = \\? AND payload = \\?/);
});

test("AI analyses read current run after provider call and do not replace other runs", () => {
  assert.match(analyze,/const latest = await getBundle\(\)/);
  assert.match(analyze,/updateRunHistorySafely\(\[currentRun\], \[updatedRun\]\)/);
  assert.doesNotMatch(analyze,/saveBundle\(\{\s*runs/);
});

test("run log imports append instead of rewriting every run", () => {
  assert.match(imported,/appendRunHistorySafely/);
  assert.doesNotMatch(imported,/saveBundle\(\{\s*runs/);
});
