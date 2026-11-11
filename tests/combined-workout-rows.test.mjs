import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sub20Workouts } from "../src/lib/sub20-34week-plan.ts";
import { groupCombinedStrengthDays } from "../src/lib/combined-workout-rows.ts";

const original = sub20Workouts();
const grouped = groupCombinedStrengthDays(original);
const dashboard = readFileSync("src/components/dashboard.tsx", "utf8");

test("All 32 Wednesday run / Strength A overlaps render as one combined row", () => {
  const overlaps = grouped.filter(row => row.linkedRun !== null);
  assert.equal(original.length, 219);
  assert.equal(overlaps.length, 32);
  assert.equal(grouped.length, 187);
  assert.equal(new Set(overlaps.map(row => row.workout.date)).size, 32);
  assert.equal(overlaps[0].workout.date, "2026-11-18");
  assert.equal(overlaps.at(-1).workout.date, "2027-06-23");
  const nov25 = overlaps.find(row => row.workout.date === "2026-11-25");
  assert.ok(nov25);
  assert.equal(nov25.workout.phase, "REBUILD • STRENGTH A");
  assert.match(nov25.workout.target || "", /5 km EASY/);
  assert.equal(nov25.linkedRun?.target, "5 km EASY 6:30–7:30+/km · HR ~135–155 · RPE 2–3");
  assert.ok(nov25.workout.strength);
  assert.ok(grouped.some(row => row.workout.date === "2026-11-11" && !row.linkedRun &&
    !!row.workout.strength), "Week 2's strength-only day stays unchanged");
});

test("Both source records remain intact, with independent progress and history", () => {
  const pair = grouped.find(row => row.workout.date === "2026-11-25");
  assert.ok(pair?.linkedRun);
  assert.equal(original.filter(w => w.date === "2026-11-25").length, 2);
  assert.notEqual(pair.workout.id, pair.linkedRun.id);
  assert.equal(pair.linkedRun.strength, undefined);
  const completed = original.map(w => w.date === "2026-11-25" && !w.strength
    ? { ...w, status: "completed" } : w);
  const after = groupCombinedStrengthDays(completed).find(row => row.workout.date === "2026-11-25");
  assert.equal(after?.linkedRun?.status, "completed");
  assert.equal(after?.workout.status, "planned");
});

test("Never merge unrelated double sessions, modified prescriptions or mismatched dates", () => {
  const w = original.find(row => row.date === "2026-11-25" && !row.strength);
  const strength = original.find(row => row.date === "2026-11-25" && row.strength);
  assert.ok(w && strength);
  const unrelated = { ...w, id: "manual-second-run" };
  assert.equal(groupCombinedStrengthDays([w, strength, unrelated]).length, 2);
  const edited = { ...w, target: "Different workout" };
  assert.equal(groupCombinedStrengthDays([edited, strength]).length, 2);
  const rescheduled = { ...w, date: "2026-11-26" };
  assert.equal(groupCombinedStrengthDays([rescheduled, strength]).length, 2);
});

test("Training Block has separate Log run and Log strength controls and preserves records", () => {
  assert.match(dashboard, /groupCombinedStrengthDays\(activePlan\)/);
  assert.match(dashboard, /selectedWorkoutRows\.map\(\(\{ workout, linkedRun \}/);
  assert.match(dashboard, /Log run/);
  assert.match(dashboard, /Log strength/);
  assert.match(dashboard, /setCompletionWorkout\(linkedRun\)/);
  assert.match(dashboard, /setStrengthLogWorkout\(workout\)/);
  assert.match(dashboard, /combinedPlanRows\.filter/);
  assert.match(dashboard, /bundle\.plan\.filter\(\(workout\) => workout\.status !== "superseded"\)/);
});
