import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync("src/components/dashboard.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

test("Distance over time visibly shows the summed distance of the selected chart bins", () => {
  assert.match(code, /const chartMileage = chart\.reduce\(\(sum, point\) => sum \+ point\.distance, 0\)/);
  assert.match(code, /\{chartMileage\.toFixed\(2\)\} <small>km<\/small>/);
  assert.match(code, /className="chart-mileage" aria-live="polite"/);
  assert.ok(!code.includes("<span>${chartMode"), "Chart period caption must use a JSX expression, not literal template text");
  assert.match(css, /\.chart-mileage\{/);
});

test("weekly and monthly totals follow the existing period selector and navigation", () => {
  assert.match(code, /chartMode === "week" \? \(chartShift === 0 \? "This week" : "Selected week"\)/);
  assert.match(code, /chartShift === 0 \? "This month" : "Selected month"/);
  assert.match(code, /setChartMode\(event.target.value as "week" \| "month"\)/);
  assert.match(code, /setChartShift\(\(value\) => value - 1\)/);
  assert.match(code, /setChartShift\(\(value\) => Math\.min\(0, value \+ 1\)\)/);
});

test("the monthly chart bins include only runs from the selected calendar month", () => {
  assert.match(code, /day >= monthlyStart && day < new Date\(monthlyStart\.getFullYear\(\), monthlyStart\.getMonth\(\) \+ 1, 1\)/);
  assert.match(code, /const bins = chartMode === "week" \? 7/);
  assert.match(code, /chartMode === "week" \? 1 : 7/);
});

test("this presentation-only change does not alter run persistence or the workout plan", () => {
  assert.ok(code.includes("complete-workout"));
  assert.ok(code.includes("const completedCount = bundle.plan.filter"));
});
