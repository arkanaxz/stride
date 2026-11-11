import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRENGTH_PAGE_SIZES, searchStrengthWorkouts, paginateStrengthWorkouts, strengthWeekday } from "../src/lib/strength-history-utils.ts";

const dashboard=readFileSync("src/components/dashboard.tsx","utf8");
const css=readFileSync("src/app/globals.css","utf8");
const table=readFileSync("src/components/strength-history-table.tsx","utf8");
const workouts=Array.from({length:23},(_,i)=>({
  id:"strength-"+i,week:2,session:i%2?"Strength B":"Strength A",date:"2026-11-"+String(i+1).padStart(2,"0"),
  strength:"Glute bridge and core",status:"completed",
  strengthLog:{date:"2026-11-"+String(i+1).padStart(2,"0"),name:i%2?"Strength B":"Strength A",type:i%2?"Strength B":"Strength A",
    duration:20+i,avgHr:110+i,maxHr:140,sleep:6,rpe:i%6+1,painDuring:i===10?"3/10":"0",painNext:"0",
    location:"Lapu-Lapu City",exercises:i===10?"Single-leg RDL":"Glute bridge",
    notes:i===10?"Added resistance":"Felt good"},
}));
test("Strength history is below run history and shoe mileage, only once, at the dashboard bottom",()=>{
  const pos=dashboard.indexOf('<section className="card strength-history-card"');
  assert.ok(pos>dashboard.indexOf('<h2><a className="section-tab-link" href="/history">Run history</a>'));
  assert.ok(pos>dashboard.indexOf('<h2>Shoe mileage</h2>'));
  assert.ok(pos<dashboard.indexOf('</> : bundle.user?.role === "admin" ? <Settings'));
  assert.equal(dashboard.match(/<section className="card strength-history-card"/g)?.length,1);
  assert.match(dashboard,/<StrengthHistoryTable/);
});
test("Strength history displays below Run History in the flex layout, not just the JSX",()=>{
  // The .shell flex container has explicit section orders. Without these rules,
  // Strength History defaults to order:0 and unexpectedly jumps to the top.
  assert.match(css,/\.shell>\.two-columns\{order:4\}/);
  assert.match(css,/\.shell>\.vo2-trend-card\{order:4\}/);
  assert.match(css,/\.shell>\.strength-history-card\{order:5\}/);
  assert.match(css,/\.shell>\.account-actions\{order:6\}/);
});
test("Search matches workouts, weekdays, date, exercises, notes, pain, and locations",()=>{
  assert.equal(searchStrengthWorkouts(workouts,"strength b").length,11);
  assert.equal(searchStrengthWorkouts(workouts,"2026-11-11").length,1);
  assert.equal(searchStrengthWorkouts(workouts,"Wednesday").length,3);
  assert.equal(searchStrengthWorkouts(workouts,"Single-leg RDL").length,1);
  assert.equal(searchStrengthWorkouts(workouts,"Added resistance").length,1);
  assert.equal(searchStrengthWorkouts(workouts,"3/10").length,1);
  assert.equal(searchStrengthWorkouts(workouts,"Lapu-Lapu").length,23);
  assert.equal(searchStrengthWorkouts(workouts,"not present").length,0);
  assert.equal(searchStrengthWorkouts(workouts,"  ").length,23);
});
test("All requested page sizes, previous/next and empty result boundaries work",()=>{
  assert.deepEqual(STRENGTH_PAGE_SIZES,[1,5,10,15,20,100]);
  for(const size of STRENGTH_PAGE_SIZES){
    const first=paginateStrengthWorkouts(workouts,size,0);
    const next=paginateStrengthWorkouts(workouts,size,1);
    assert.equal(first.rows.length,Math.min(size,23));
    assert.equal(first.pageCount,Math.max(1,Math.ceil(23/size)));
    if(size<23)assert.equal(next.rows[0]?.id,"strength-"+size);
    assert.equal(paginateStrengthWorkouts(workouts,size,-3).page,0);
    assert.equal(paginateStrengthWorkouts(workouts,size,999).page,first.pageCount-1);
  }
  const empty=paginateStrengthWorkouts([],5,15);
  assert.deepEqual([empty.page,empty.pageCount,empty.total],[0,1,0]);
});
test("Column picker persists a separate layout and preserves strength details access",()=>{
  assert.equal(strengthWeekday("2026-11-11"),"Wednesday");
  assert.match(table,/Choose columns/);
  assert.match(table,/history-column-picker/);
  assert.match(table,/localStorage\.setItem/);
  assert.match(table,/stride-strength-history-columns-v1/);
  assert.match(table,/aria-label="Search strength workout history"/);
  assert.match(table,/STRENGTH_PAGE_SIZES\.map/);
  assert.match(table,/column-resize/);
  assert.match(table,/onOpen\(w\)/);
  assert.match(table,/w\.strengthLog \? "View \/ edit details" : "Add workout details"/);
  for(const prohibited of ["Distance", "Pace", "Garmin VO₂", "Relative Effort", "Shoes", "Temperature at"]){
    assert.ok(!table.includes('label: "'+prohibited+'"'),"No running-only strength column: "+prohibited);
  }
});
