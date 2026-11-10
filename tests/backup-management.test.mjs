import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui=readFileSync("src/components/dashboard.tsx","utf8");
const manager=readFileSync("src/components/backup-manager.tsx","utf8");
const db=readFileSync("src/lib/database.ts","utf8");
const list=readFileSync("src/app/api/backups/route.ts","utf8");
const download=readFileSync("src/app/api/backups/[key]/route.ts","utf8");
const restore=readFileSync("src/app/api/backups/restore-plan/route.ts","utf8");
const css=readFileSync("src/app/globals.css","utf8");

test("backup link has moved off Training Block and into Settings",()=>{
  const training=ui.slice(ui.indexOf('className="card training-card"'),ui.indexOf('className="stats-grid"'));
  assert.ok(!training.includes('href="/api/backup/34week"'));
  assert.ok(!training.includes('Download pre-update backup'));
  const settings=ui.slice(ui.indexOf("function Settings("));
  assert.ok(settings.includes("<BackupManager onToast={onToast}/>"));
  assert.match(css,/\.backup-manager-header/);
});
test("recovery listing is dynamic, admin-only and does not expose stored passwords",()=>{
  assert.match(list,/user\?\.role !== "admin"/);
  assert.match(download,/user\?\.role !== "admin"/);
  assert.match(restore,/user\?\.role !== "admin"/);
  assert.ok(db.includes("export async function listRecoveryPoints"));
  assert.ok(db.includes("export async function createRecoveryPoint"));
  assert.ok(db.includes("export async function exportRecoveryPoint"));
  assert.ok(!list.includes("secrets") && !list.includes("password_hash"));
  assert.ok(manager.includes("Create backup now") && manager.includes("Restore plan"));
});
test("restoration is explicit, backup-first, plan-only, and never deletes existing run records",()=>{
  assert.match(restore,/body.confirm !== "RESTORE PLAN"/);
  assert.match(manager,/confirmation !== "RESTORE PLAN"/);
  const code=db.slice(db.indexOf("export async function restoreFuturePlanFromRecoveryPoint"),db.indexOf("export async function exportPre34WeekSnapshot"));
  assert.match(code,/const statements = \[\.\.\.backup, \.\.\.sql\]/);
  assert.match(code,/await cloud.batch\(statements, "write"\)/);
  assert.match(code,/local!\.exec\("BEGIN IMMEDIATE"\)/);
  assert.doesNotMatch(code,/DELETE FROM runs|DELETE FROM workouts|DROP TABLE|UPDATE runs/);
  assert.match(code,/workout\.date <= today/);
  assert.match(code,/workout\.status === "completed"/);
  assert.match(code,/status: "superseded"/);
});
