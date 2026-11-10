import test from "node:test";
import assert from "node:assert/strict";
import { sub20Source, sub20Workouts, SUB20_34W_PRESERVE_THROUGH } from "../src/lib/sub20-34week-plan.ts";

test("Source uses only the two requested sheets, with verified integrity", () => {
  const data=sub20Source();
  assert.equal(data.weeks.length,33);
  assert.equal(data.weeks[0].week,2);
  assert.equal(data.weeks[0].monday,"2026-11-09");
  assert.equal(data.weeks.at(-1).week,34);
  assert.equal(data.weeks.at(-1).monday,"2027-06-21");
  assert.equal(data.strength.A.length,6);
  assert.equal(data.strength.B.length,5);
  assert.equal(data.strength.rules.length,7);
});
test("Import preserves Nov 10 and exactly 219 full prescriptions",()=>{
  const entries=sub20Workouts();
  assert.equal(entries.length,219);
  assert.equal(entries.filter(e=>!e.strength).length,153);
  assert.equal(entries.filter(e=>e.strength).length,66);
  assert.ok(entries.every(e=>e.date>SUB20_34W_PRESERVE_THROUGH && e.status==="planned" && e.dateShiftable===false));
  assert.equal(entries.filter(e=>e.date==="2026-11-10").length,0);
  assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
});
test("Week 2 uses modified Strength A and November 10 is left untouched",()=>{
  const entries=sub20Workouts();
  const week2=entries.filter(e=>e.week===2);
  assert.equal(week2.length,5);
  assert.deepEqual(week2.map(e=>e.date),["2026-11-11","2026-11-12","2026-11-13","2026-11-14","2026-11-15"]);
  assert.match(week2[0].strength,/Do NOT perform lateral step-down/);
  assert.match(week2[0].strength,/20–25 min/);
  assert.match(week2[1].target,/3×3:00 @ 5:40–5:55\/km/);
});
test("Wednesday easy running and Strength A are distinct trackable entries",()=>{
  const entries=sub20Workouts();
  const nov18=entries.filter(e=>e.date==="2026-11-18");
  assert.equal(nov18.length,2);
  assert.ok(nov18.some(e=>!!e.strength && e.strength.includes("Lateral step-down")));
  assert.ok(nov18.some(e=>!e.strength && e.target?.includes("4 km EASY")));
});
test("March HM and June 5K source dates are preserved",()=>{
  const entries=sub20Workouts();
  assert.ok(entries.some(e=>e.date==="2027-03-07" && e.target?.includes("SM2SM FUN RUN")));
  assert.ok(entries.some(e=>e.date==="2027-06-26" && e.target?.includes("5K A-TEST")));
});
