import assert from "node:assert/strict";
import test from "node:test";
import { strengthPlanWorkouts, STRENGTH_PLAN_SEED_KEY } from "../src/lib/strength-plan.ts";

test("the uploaded 18-week plan yields 33 Wednesday/Friday work sessions", () => {
  assert.equal(strengthPlanWorkouts.length, 33);
  assert.equal(new Set(strengthPlanWorkouts.map((workout) => workout.id)).size, 33);
  assert.equal(strengthPlanWorkouts.filter((workout) => workout.day === "Wed").length, 18);
  assert.equal(strengthPlanWorkouts.filter((workout) => workout.day === "Fri").length, 15);
  assert.equal(strengthPlanWorkouts.filter((workout) => workout.status === "planned").length, 33);
});

test("dates and race-week mobility are extracted correctly", () => {
  const first = strengthPlanWorkouts.find((workout) => workout.week === 1 && workout.day === "Wed");
  assert.equal(first?.date, "2026-11-04");
  const friday = strengthPlanWorkouts.find((workout) => workout.week === 1 && workout.day === "Fri");
  assert.equal(friday?.date, "2026-11-06");
  const w6 = strengthPlanWorkouts.filter((workout) => workout.week === 6);
  assert.equal(w6.length, 1);
  const last = strengthPlanWorkouts.find((workout) => workout.week === 18);
  assert.equal(last?.date, "2027-03-03");
  assert.match(last?.session || "", /MOBILITY ONLY/);
});

test("sessions contain the worksheet exercise detail and stable seed marker", () => {
  assert.match(STRENGTH_PLAN_SEED_KEY, /v1$/);
  const a = strengthPlanWorkouts.find((workout) => workout.week === 2 && workout.day === "Wed");
  assert.match(a?.strength || "", /Lateral step-down/);
  assert.match(a?.strength || "", /Single-leg RDL/);
  const b = strengthPlanWorkouts.find((workout) => workout.week === 2 && workout.day === "Fri");
  assert.match(b?.strength || "", /Dead bug/);
});
