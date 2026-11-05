import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/recover-runs/route.ts","utf8");
const ui = readFileSync("src/components/recover-missing-runs.tsx","utf8");
const db = readFileSync("src/lib/database.ts","utf8");

test("restore only targets the four missing dates and must be administrator-authenticated", () => {
  for (const date of ["2026-10-29","2026-10-30","2026-11-03","2026-11-04"]) assert.ok(route.includes(date));
  assert.match(route,/user\?\.role !== "admin"/);
});

test("backup connection is restricted to Turso and executed read-only", () => {
  assert.match(route,/host\.endsWith\("\.turso\.io"\)/);
  assert.match(route,/SELECT id, payload FROM runs/);
  assert.match(route,/process\.env\.TURSO_DATABASE_URL/);
  assert.doesNotMatch(route,/source\.execute\(\s*["'](?:INSERT|UPDATE|DELETE)/i);
});

test("recovery is selective append with a confirmation preview, no destructive save", () => {
  assert.match(route,/appendRunHistorySafely\(missing\)/);
  assert.match(ui,/Preview recovery/);
  assert.match(ui,/window\.confirm/);
  assert.match(ui,/Restore these/);
  assert.doesNotMatch(route,/saveBundle\(\{\s*runs/);
  assert.match(db,/INSERT INTO runs \(payload\) VALUES/);
});
