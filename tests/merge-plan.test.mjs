import assert from "node:assert/strict";
import test from "node:test";
import { mergeRevisedPlan } from "../src/lib/merge-plan.ts";

function workout(week, day, date, status, notes = "") {
  return {
    id: `sm2sm-2027-gm-${date}-${day.toLowerCase()}`,
    week, day, date, session: `${day}: Training`, target: "old target", status, notes,
  };
}

test("revised 82-session plan never rewrites a completed workout", () => {
  const existing = [workout(1, "Tue", "2026-11-03", "completed", "Actual logged details")];
  const updated = workout(1, "Tue", "2026-11-03", "planned");
  updated.target = "updated target";
  const result = mergeRevisedPlan(existing, [updated]);
  assert.equal(result.plan.length, 1);
  assert.equal(result.preservedCompleted, 1);
  assert.equal(result.plan[0].status, "completed");
  assert.equal(result.plan[0].target, "old target");
  assert.equal(result.plan[0].notes, "Actual logged details");
  assert.equal(existing[0].status, "completed");
});

test("match completed records when revised workbook changes session date", () => {
  const oldCompleted = workout(1, "Tue", "2026-11-03", "completed");
  const newDate = workout(1, "Tue", "2026-11-10", "planned");
  const result = mergeRevisedPlan([oldCompleted], [newDate]);
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].date, "2026-11-03");
  assert.equal(result.plan[0].status, "completed");
});

test("replace planned targets while preserving cancellation statuses", () => {
  const oldPlanned = workout(1, "Tue", "2026-11-03", "planned");
  const oldCancelled = workout(1, "Thu", "2026-11-05", "cancelled");
  const revisedA = { ...oldPlanned, target: "7 km" };
  const revisedB = { ...oldCancelled, target: "9 km", status: "planned" };
  const result = mergeRevisedPlan([oldPlanned, oldCancelled], [revisedA, revisedB]);
  assert.equal(result.plan.length, 2);
  assert.equal(result.plan[0].target, "7 km");
  assert.equal(result.plan[1].target, "9 km");
  assert.equal(result.plan[1].status, "cancelled");
  assert.equal(result.preservedCancelled, 1);
});

test("preserve unmatched historical workouts, discard obsolete planned items", () => {
  const complete = workout(0, "Sat", "2026-10-31", "completed");
  const cancelled = workout(0, "Sun", "2026-11-01", "cancelled");
  const obsolete = workout(0, "Mon", "2026-10-26", "planned");
  const fresh = workout(1, "Tue", "2026-11-03", "planned");
  const result = mergeRevisedPlan([complete, cancelled, obsolete], [fresh]);
  assert.equal(result.plan.length, 3);
  assert.equal(result.plan.some(w => w.id === obsolete.id), false);
  assert.equal(result.plan.some(w => w.id === complete.id && w.status === "completed"), true);
  assert.equal(result.plan.some(w => w.id === cancelled.id && w.status === "cancelled"), true);
});

test("reimport leaves exactly 82 slots when all completed sessions match", () => {
  const revised = Array.from({length: 82}, (_, i) => workout(i+1, "Tue", `2026-11-${String(i+1).padStart(2,"0")}`, "planned"));
  const complete = { ...revised[0], status: "completed", notes: "Actual session" };
  const result = mergeRevisedPlan([complete], revised);
  assert.equal(result.plan.length, 82);
  assert.equal(result.plan.filter(w => w.status === "completed").length, 1);
});
