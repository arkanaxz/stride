"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import { localDateKey, selectVo2Points, vo2Points, vo2RangeBounds, type Vo2Range, type Vo2Bounds } from "@/lib/vo2-date-filter";

function dateLabel(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function labelForRange(mode: Vo2Range, bounds: Vo2Bounds, firstDate?: string): string {
  if (mode === "all") return firstDate ? dateLabel(firstDate) + " – Today" : "From first entry to today";
  if (mode === "year") return bounds.start.slice(0, 4);
  if (mode === "month") {
    return new Date(bounds.start + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const first = dateLabel(bounds.start);
  const end = new Date(bounds.endExclusive + "T12:00:00");
  end.setDate(end.getDate() - 1);
  return first + " – " + dateLabel(localDateKey(end));
}

export default function GarminVo2MaxTrend({ runs }: { runs: Run[] }) {
  const [range, setRange] = useState<Vo2Range>("all");
  const [shift, setShift] = useState(0);
  const today = localDateKey(new Date());
  const allData = useMemo(() => vo2Points(runs), [runs]);
  const data = useMemo(() => selectVo2Points(allData, range, shift, today), [allData, range, shift, today]);
  const bounds = vo2RangeBounds(range, shift, today);
  const previousBounds = vo2RangeBounds(range, shift - 1, today);
  const canGoPrevious = range !== "all" && allData.length > 0 &&
    previousBounds.endExclusive > allData[0].date;
  const periodLabel = labelForRange(range, bounds, allData[0]?.date);
  const first = data[0];
  const latest = data.at(-1);
  const change = first && latest && first !== latest ? latest.value - first.value : null;
  const current = latest ? latest.value.toFixed(1).replace(/\.0$/, "") : "—";

  const plot = { left: 54, right: 692, top: 23, bottom: 178 };
  const values = data.map(point => point.value);
  const smallest = values.length ? Math.min(...values) : 40;
  const biggest = values.length ? Math.max(...values) : 50;
  const yMin = Math.max(0, Math.floor(smallest - 2));
  const yMax = Math.ceil(biggest + 2);
  const yRange = Math.max(1, yMax - yMin);
  const xDates = data.map(point => Date.parse(point.date + "T12:00:00Z"));
  const startDate = xDates[0] || 0;
  const endDate = xDates.at(-1) || 0;
  const xRange = Math.max(1, endDate - startDate);
  const points = data.map((point, i) => ({
    ...point,
    x: startDate === endDate ? (plot.left + plot.right) / 2 : plot.left + (xDates[i] - startDate) / xRange * (plot.right - plot.left),
    y: plot.bottom - (point.value - yMin) / yRange * (plot.bottom - plot.top),
  }));
  const line = points.map(point => point.x.toFixed(1) + "," + point.y.toFixed(1)).join(" ");
  const grid = Array.from({ length: 4 }, (_, i) => {
    const fraction = i / 3;
    return { value: (yMax - fraction * yRange).toFixed(1).replace(/\.0$/, ""), y: plot.top + fraction * (plot.bottom - plot.top) };
  });
  const axisIndices = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])].filter(i => i >= 0);

  return <section className="card vo2-trend-card" aria-label="Garmin VO2 Max trend">
    <div className="vo2-trend-header">
      <div>
        <div className="eyebrow">AEROBIC FITNESS</div>
        <h2>Garmin VO₂ Max trend</h2>
        <p className="muted">Your Garmin-estimated VO₂ max, tracked by run date. Values in mL/kg/min.</p>
      </div>
      <div className="vo2-summary" aria-label="VO2 max summary">
        <div><span>{range === "all" ? "Latest" : "Latest in period"}</span><strong>{current}</strong></div>
        <div><span>{range === "all" ? "Since first entry" : "Period change"}</span><strong className={change !== null ? (change > 0 ? "vo2-rise" : change < 0 ? "vo2-fall" : "") : ""}>{change == null ? "—" : (change > 0 ? "+" : "") + change.toFixed(1)}</strong></div>
        <div><span>Recorded days</span><strong>{data.length}</strong></div>
      </div>
    </div>
    <div className="vo2-range-controls">
      <label className="compact-field">Show
        <select aria-label="Garmin VO2 Max time range" value={range} onChange={(event) => {
          setRange(event.target.value as Vo2Range);
          setShift(0);
        }}>
          <option value="all">All time</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
      </label>
      <div className="vo2-range-nav">
        {range !== "all" && <button type="button" className="btn" aria-label={"Previous " + range}
          disabled={!canGoPrevious} onClick={() => setShift(value => value - 1)}>‹</button>}
        <span aria-live="polite">{periodLabel}</span>
        {range !== "all" && <button type="button" className="btn" aria-label={"Next " + range}
          disabled={shift >= 0} onClick={() => setShift(value => Math.min(0, value + 1))}>›</button>}
      </div>
    </div>
    {data.length ? <div className="vo2-chart-wrap">
      <svg className="vo2-chart-svg" viewBox="0 0 720 228" role="img" aria-label={"Garmin VO2 max from " + dateLabel(first.date) + " to " + dateLabel(latest!.date)}>
        {grid.map((tick, index) => <g key={index}>
          <line x1={plot.left} y1={tick.y} x2={plot.right} y2={tick.y} className="gridline" />
          <text x={plot.left - 12} y={tick.y + 4} textAnchor="end" className="vo2-axis-label">{tick.value}</text>
        </g>)}
        {points.length > 1 && <polyline points={line} className="vo2-line"/>}
        {points.map(point => <g key={point.date} className="vo2-point">
          <circle cx={point.x} cy={point.y} r="6"/>
          <title>{dateLabel(point.date) + ": " + point.value + " mL/kg/min"}</title>
        </g>)}
        {axisIndices.map(index => <text key={index} x={points[index].x} y="206" textAnchor={index === 0 && points.length > 1 ? "start" : index === points.length - 1 && points.length > 1 ? "end" : "middle"} className="vo2-axis-label">{new Date(points[index].date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>)}
      </svg>
    </div> : <p className="vo2-empty">{allData.length
      ? "No Garmin VO₂ Max readings for this period. Choose another date range to view recorded estimates."
      : "No Garmin VO₂ Max entries yet. Add your watch's VO₂ max estimate when logging a run, or edit a previous run to backfill an earlier value."}</p>}
    <p className="muted vo2-footnote">Enter the Garmin Connect or watch estimate manually; Stride does not automatically sync from Garmin. Watch estimates fluctuate with training conditions, so compare the longer-term trend rather than a single reading.</p>
  </section>;
}
