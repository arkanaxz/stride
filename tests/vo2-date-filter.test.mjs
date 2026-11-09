import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localDateKey, selectVo2Points, vo2Points, vo2RangeBounds } from "../src/lib/vo2-date-filter.ts";

const today = "2026-11-09";
const runs = [
  { id: 1, date:"2025-12-15", garminVo2Max:44 },
  { id: 2, date:"2026-01-01", garminVo2Max:45 },
  { id: 3, date:"2026-10-31", garminVo2Max:46 },
  { id: 4, date:"2026-11-01", garminVo2Max:47 },
  { id: 5, date:"2026-11-02", garminVo2Max:47.5 },
  { id: 6, date:"2026-11-08", garminVo2Max:48 },
  { id: 7, date:"2026-11-08", garminVo2Max:49 },
  { id: 8, date:"2026-11-09", garminVo2Max:50 },
  { id: 9, date:"2026-11-10", garminVo2Max:51 },
  { id: 10, date:"2026-11-07", garminVo2Max:null },
];
const points=vo2Points(runs);
const dates=(mode,shift=0)=>selectVo2Points(points,mode,shift,today).map(point=>point.date);

test("all-time starts at first recorded day, excludes dates after today, and deduplicates readings",()=>{
  assert.deepEqual(dates("all"),["2025-12-15","2026-01-01","2026-10-31","2026-11-01","2026-11-02","2026-11-08","2026-11-09"]);
  assert.equal(points.find(point=>point.date==="2026-11-08")?.value,49);
  assert.equal(vo2RangeBounds("all",0,today).endExclusive,"2026-11-10");
});
test("weekly is Monday through Sunday; previous week and current week are separate",()=>{
  assert.deepEqual(vo2RangeBounds("week",0,today),{start:"2026-11-09",endExclusive:"2026-11-16"});
  assert.deepEqual(dates("week"),["2026-11-09"]);
  assert.deepEqual(dates("week",-1),["2026-11-02","2026-11-08"]);
  assert.deepEqual(dates("week",-2),["2026-10-31","2026-11-01"]);
});
test("monthly shows all samples in calendar month and respects previous month boundary",()=>{
  assert.deepEqual(vo2RangeBounds("month",0,today),{start:"2026-11-01",endExclusive:"2026-12-01"});
  assert.deepEqual(dates("month"),["2026-11-01","2026-11-02","2026-11-08","2026-11-09"]);
  assert.deepEqual(dates("month",-1),["2026-10-31"]);
});
test("yearly includes only current year and allows previous year",()=>{
  assert.deepEqual(vo2RangeBounds("year",0,today),{start:"2026-01-01",endExclusive:"2027-01-01"});
  assert.deepEqual(dates("year"),["2026-01-01","2026-10-31","2026-11-01","2026-11-02","2026-11-08","2026-11-09"]);
  assert.deepEqual(dates("year",-1),["2025-12-15"]);
});
test("empty weeks have no readings; leap February uses exact calendar boundaries",()=>{
  assert.deepEqual(dates("week",-3),[]);
  assert.deepEqual(vo2RangeBounds("month",0,"2024-02-29"),{start:"2024-02-01",endExclusive:"2024-03-01"});
  assert.equal(localDateKey(new Date("2024-03-01T12:00:00")), "2024-03-01");
});
test("VO2 view exposes four filters, period navigation, empty state and scope-aware summary",()=>{
  const source=readFileSync("src/components/garmin-vo2max-trend.tsx","utf8");
  const css=readFileSync("src/app/globals.css","utf8");
  for(const [value,label] of [["all","All time"],["week","Weekly"],["month","Monthly"],["year","Yearly"]]){
    assert.ok(source.includes('<option value="'+value+'">'+label+'</option>'));
  }
  assert.match(source,/selectVo2Points\(allData, range, shift, today\)/);
  assert.match(source,/setShift\(0\)/);
  assert.match(source,/disabled=\{shift >= 0\}/);
  assert.match(source,/No Garmin VO₂ Max readings for this period/);
  assert.match(source,/range === "all" \? "Since first entry" : "Period change"/);
  assert.match(css,/\.vo2-range-controls\{/);
  assert.doesNotMatch(source,/\/api\/data|fetch\(/);
});
