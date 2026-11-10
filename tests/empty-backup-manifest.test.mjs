import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const db=readFileSync("src/lib/database.ts","utf8");
const start=db.indexOf("export async function ensureSub2034WeekPlan()");
const end=db.indexOf("export async function exportPre34WeekSnapshot");
const migration=db.slice(start,end);

test("backup manifest exists even if every original source table has zero records",()=>{
  assert.match(migration,/const backupManifest = \{/);
  assert.match(migration,/'manifest', '__snapshot'/);
  assert.match(migration,/const tableCountsSql = "json_object\("/);
  assert.match(migration,/backupManifest,\s*\.\.\.backup,\s*\{ sql: supersedeSql/);
  assert.match(migration,/await cloud.batch\(sql, "write"\)/);
  assert.match(migration,/local!\.exec\("ROLLBACK"\)/);
  assert.doesNotMatch(migration,/DELETE FROM runs|DELETE FROM workouts|DROP TABLE/);
});
