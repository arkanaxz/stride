"use client";

import { useEffect, useMemo, useState } from "react";
import type { Run } from "@/lib/types";

type Column = {
  key: string;
  label: string;
  width: number;
  render: (run: Run) => string;
};

function weekdayForRunDate(date: string): string {
  // Parse locally at noon to avoid timezone offsets changing the calendar day.
  const parsed = new Date(date + "T12:00:00");
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(parsed);
}

function formatPace(run: Run) {
  if (!Number(run.distance) || !Number(run.duration)) return "—";
  const totalSeconds = Math.round(Number(run.duration) * 60 / Number(run.distance));
  return Math.floor(totalSeconds / 60) + ":" + String(totalSeconds % 60).padStart(2, "0");
}

const columns: Column[] = [
  { key: "date", label: "Date", width: 125, render: run => run.date },
  { key: "name", label: "Run", width: 160, render: run => run.name || "Run" },
  { key: "type", label: "Type", width: 105, render: run => run.type || "—" },
  { key: "distance", label: "Distance", width: 105, render: run => Number(run.distance).toFixed(2) + " km" },
  { key: "duration", label: "Duration", width: 115, render: run => {
    const secs = Math.round(Number(run.duration || 0) * 60);
    return Math.floor(secs / 3600) + ":" + String(Math.floor((secs % 3600) / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
  }},
  { key: "pace", label: "Pace", width: 100, render: formatPace },
  { key: "avgHr", label: "Avg HR", width: 90, render: run => run.avgHr == null ? "—" : String(run.avgHr) },
  { key: "maxHr", label: "Max HR", width: 90, render: run => run.maxHr == null ? "—" : String(run.maxHr) },
  { key: "garminVo2Max", label: "Garmin VO₂ Max", width: 130, render: run => run.garminVo2Max == null ? "—" : String(run.garminVo2Max) },
  { key: "sleep", label: "Sleep", width: 100, render: run => run.sleep == null ? "—" : Number(run.sleep).toFixed(2) + " h" },
  { key: "rpe", label: "RPE", width: 75, render: run => run.rpe == null ? "—" : String(run.rpe) },
  { key: "effort", label: "Relative Effort", width: 125, render: run => run.effort == null ? "—" : String(run.effort) },
  { key: "painDuring", label: "ITB During", width: 105, render: run => run.painDuring || String(run.pain ?? "—") },
  { key: "painNext", label: "ITB Next", width: 95, render: run => run.painNext || "—" },
  { key: "shoes", label: "Shoes", width: 155, render: run => run.shoes || "—" },
  { key: "location", label: "Location", width: 165, render: run => run.location || "—" },
  { key: "weatherStart", label: "Weather Start", width: 160, render: run => run.weatherStart || "—" },
  { key: "weatherEnd", label: "Weather End", width: 160, render: run => run.weatherEnd || "—" },
  { key: "startTime", label: "Start Time", width: 110, render: run => run.startTime || "—" },
  { key: "endTime", label: "End Time", width: 110, render: run => run.endTime || "—" },
  { key: "notes", label: "Notes", width: 240, render: run => run.notes || "—" },
];

const defaultKeys = ["date", "name", "distance", "pace", "avgHr", "painDuring"];
const keysStorage = "stride-history-columns-v1";
const widthsStorage = "stride-history-widths-v1";

function readKeys() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keysStorage) || "null");
    if (Array.isArray(parsed)) {
      const cleaned = parsed.filter((key): key is string => typeof key === "string" && columns.some(c => c.key === key));
      if (cleaned.length) return cleaned;
    }
  } catch { /* use default */ }
  return defaultKeys;
}
function readWidths(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(widthsStorage) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => columns.some(c => c.key === key) && typeof value === "number" && value >= 65 && value <= 700)) as Record<string, number>;
  } catch { return {}; }
}

export default function RunHistoryTable({ runs, onOpen }: { runs: Run[]; onOpen: (run: Run) => void }) {
  const [keys, setKeys] = useState<string[]>(defaultKeys);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [columnsOpen, setColumnsOpen] = useState(false);

  useEffect(() => {
    setKeys(readKeys());
    setWidths(readWidths());
  }, []);

  const selectedColumns = useMemo(() => columns.filter(col => keys.includes(col.key)), [keys]);
  const width = (column: Column) => widths[column.key] ?? column.width;

  function toggleColumn(key: string) {
    const next = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
    if (!next.length) return;
    setKeys(next);
    localStorage.setItem(keysStorage, JSON.stringify(next));
  }
  function changeWidth(key: string, newWidth: number) {
    setWidths(old => {
      const next = { ...old, [key]: Math.max(65, Math.min(700, Math.round(newWidth))) };
      localStorage.setItem(widthsStorage, JSON.stringify(next));
      return next;
    });
  }

  return <div className="run-history-table-ui">
    <div className="history-column-controls">
      <button className="btn" type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(open => !open)}>
        {columnsOpen ? "Hide columns" : "Choose columns"}
      </button>
      <span className="muted">Drag column edges to resize · Scroll sideways for more metrics</span>
    </div>
    {columnsOpen && <div className="history-column-picker">
      {columns.map(col => <label key={col.key}><input type="checkbox" checked={keys.includes(col.key)} onChange={() => toggleColumn(col.key)}/>{col.label}</label>)}
      <button type="button" className="btn" onClick={() => {
        setKeys(defaultKeys); setWidths({});
        localStorage.removeItem(keysStorage); localStorage.removeItem(widthsStorage);
      }}>Reset layout</button>
    </div>}
    <div className="history-table-scroll" tabIndex={0} role="region" aria-label="Scrollable run history table">
      <table className="custom-run-table" style={{ width: selectedColumns.reduce((total, column) => total + width(column), 0), minWidth: "100%" }}>
        <colgroup>{selectedColumns.map(col => <col key={col.key} style={{ width: width(col) }}/>)}</colgroup>
        <thead><tr>{selectedColumns.map(col =>
          <th key={col.key} scope="col"><span>{col.label}</span><span className="column-resize" role="separator" aria-label={"Resize " + col.label} title="Drag to resize" onPointerDown={event => {
            event.preventDefault();
            const start = event.clientX;
            const old = width(col);
            const target = event.currentTarget;
            target.setPointerCapture(event.pointerId);
            const handleMove = (moving: PointerEvent) => changeWidth(col.key, old + moving.clientX - start);
            const stop = () => {
              target.removeEventListener("pointermove", handleMove);
              target.removeEventListener("pointerup", stop);
              target.removeEventListener("pointercancel", stop);
            };
            target.addEventListener("pointermove", handleMove);
            target.addEventListener("pointerup", stop);
            target.addEventListener("pointercancel", stop);
          }}/></th>)}</tr></thead>
        <tbody>{runs.map((run, index) =>
          <tr key={run.id ?? run.date + "-" + index}>{selectedColumns.map(col =>
            <td key={col.key}>{col.key === "date" ?
              <span className="history-date-cell"><strong>{run.date}</strong><small className="table-sub">{weekdayForRunDate(run.date)}</small></span> :
              col.key === "name" ?
              <button type="button" className="run-name-button" onClick={() => onOpen(run)}><strong>{run.name}</strong><small className="table-sub">{run.type}</small></button> :
              <span title={col.render(run)}>{col.render(run)}</span>}</td>)}</tr>)}</tbody>
      </table>
      {!runs.length && <p className="empty">No runs to display.</p>}
    </div>
  </div>;
}
