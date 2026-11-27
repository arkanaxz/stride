import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NOV27_REVISION_IMPORT_KEY, NOV27_REVISION_START, NOV27_REVISION_END,
  nov27RevisionSource, nov27RevisionWorkouts,
} from "../src/lib/sub20-nov27-revision-plan.ts";
import { groupCombinedStrengthDays } from "../src/lib/combined-workout-rows.ts";

const source = nov27RevisionSource();
const workouts = nov27RevisionWorkouts();
const db = readFileSync("src/lib/database.ts", "utf8");
const api = readFileSync("src/app/api/data/route.ts", "utf8");

test("Nov 27 source hash and exactly 30 revised weeks are valid", () => {
  assert.equal(source.weeks.length, 30);
  assert.equal(source.weeks[0].week, 5);
  assert.equal(source.weeks[0].monday, "2026-11-30");
  assert.equal(source.weeks.at(-1).week, 34);
  assert.equal(source.weeks.at(-1).monday, "2027-06-21");
  assert.deepEqual(source.strength.A.map(row => row[0]).slice(0, 2),
    ["Dumbbell glute bridge", "Single-leg dumbbell RDL"]);
  assert.equal(source.strength.B.length, 6);
  assert.equal(source.weeks[0].coreKm, 30);
  assert.equal(source.weeks[0].optKm, 3);
  assert.equal(source.weeks[0].maxKm, 33);
});
test("Week 5 details match the uploaded workbook; prior weeks are outside the revision", () => {
  const week5 = workouts.filter(row => row.week === 5);
  assert.equal(week5.length, 7);
  assert.equal(week5.filter(row => !row.strength).length, 5);
  assert.equal(week5.filter(row => Boolean(row.strength)).length, 2);
  assert.deepEqual([...new Set(week5.map(row => row.date))],
    ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.match(week5.find(row => row.day === "Tue")?.target || "", /5km EASY post-TT, NO intervals/);
  assert.match(week5.find(row => row.day === "Wed")?.target || "", /Wednesday run only/);
  assert.match(week5.find(row => row.day === "Thu")?.target || "", /2×12min controlled sub-threshold/);
  assert.match(week5.find(row => row.day === "Fri")?.strength || "", /Dead bug/);
  assert.match(week5.find(row => row.day === "Sun" && row.strength)?.strength || "", /Reverse crunch/);
  assert.ok(workouts.every(row => row.week >= 5 && row.week <= 34));
  assert.ok(workouts.every(row => row.date >= NOV27_REVISION_START && row.date <= NOV27_REVISION_END));
  assert.ok(workouts.every(row => row.status === "planned" && row.dateShiftable === false));
});
test("Revision preserves source structure, TT dates, and workout IDs", () => {
  assert.equal(workouts.length, 187);
  assert.equal(workouts.filter(w => !w.strength).length, 141);
  assert.equal(workouts.filter(w => String(w.id).endsWith("-strength-a")).length, 21);
  assert.equal(workouts.filter(w => String(w.id).endsWith("-strength-b")).length, 25);
  assert.equal(new Set(workouts.map(w => w.id)).size, 187);
  assert.ok(workouts.some(w => w.date === "2027-03-07" && /HM FUN RUN/i.test(w.target || "")));
  assert.ok(workouts.some(w => w.date === "2027-06-26" && /5K A-TEST/i.test(w.target || "")));
  assert.ok(workouts.some(w => w.date === "2027-01-02" && /NOT 36km/i.test(w.target || "")));
  assert.ok(!workouts.some(w => w.day === "Wed" && w.strength));
  assert.ok(!workouts.some(w => w.day === "Mon"));
});
test("Sunday optional run and Strength A show once but stay independently logged", () => {
  const groups = groupCombinedStrengthDays(workouts);
  const paired = groups.filter(row => Boolean(row.linkedRun));
  assert.equal(paired.length, 20);
  assert.equal(groups.length, workouts.length - 20);
  const week5Sunday = paired.find(row => row.workout.date === "2026-12-06");
  assert.ok(week5Sunday?.workout.strength);
  assert.ok(week5Sunday?.linkedRun);
  assert.notEqual(week5Sunday.workout.id, week5Sunday.linkedRun.id);
  assert.equal(week5Sunday.linkedRun.strength, undefined);
  const week19Sunday = groups.filter(row => row.workout.date === "2027-03-14");
  assert.equal(week19Sunday.length, 1);
  assert.ok(week19Sunday[0].workout.strength);
  assert.equal(week19Sunday[0].linkedRun, null);
});
test("One-time migration backs up before archiving and adds workouts without deletion", () => {
  assert.match(db, /export async function ensureNov27RevisedTrainingPlan/);
  const start = db.indexOf("export async function ensureNov27RevisedTrainingPlan");
  const end = db.indexOf("export type RecoveryPoint =", start);
  const migrate = db.slice(start, end);
  assert.ok(migrate.indexOf("...snapshot") < migrate.indexOf("supersede,"));
  assert.ok(migrate.indexOf("supersede,") < migrate.indexOf("insertRevised,"));
  assert.match(migrate, /BEGIN IMMEDIATE/);
  assert.match(migrate, /ROLLBACK/);
  assert.match(migrate, /cloud\.batch\(statements, "write"\)/);
  assert.match(migrate, /NOT IN \('completed', 'superseded'\)/);
  assert.match(migrate, /strengthLog/);
  assert.match(migrate, /id LIKE 'sub20-34w-w%'/);
  assert.doesNotMatch(migrate, /DELETE FROM (?:workouts|runs)|DROP TABLE/);
  assert.match(migrate, /NOV27_REVISION_START/);
  assert.match(migrate, /NOV27_REVISION_END/);
  assert.match(migrate, /NOV27_REVISION_IMPORT_KEY/);
  assert.match(api, /await ensureSub2034WeekPlan\(\);\s*await ensureNov27RevisedTrainingPlan\(\);/);
  assert.equal(NOV27_REVISION_IMPORT_KEY, "sub20_nov27_week5_revised_plan_v1");
});
