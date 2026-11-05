"use client";

import { useEffect, useRef, useState } from "react";
import type { Run } from "@/lib/types";

type ColumnId =
  | "name" | "date" | "type" | "distance" | "duration" | "pace"
  | "avgHr" | "maxHr" | "sleep" | "rpe" | "effort"
  | "painDuring" | "painNext" | "shoes" | "location"
  | "weatherStart" | "weatherEnd" | "startTime" | "endTime" | "notes";

type Column = { id: ColumnId; label: string; width: number };
const COLUMNS: Column[] = [
  { id: "name", label: "Run", width: 190 },
  { id: "date", label: "Date", width: 120 },
  { id: "type", label: "Type", width: 105 },
  { id: "distance", label: "Distance", width: 110 },
  { id: "duration", label: "Duration", width: 115 },
  { id: "pace", label: "Pace", width: 105 },
  { id: "avgHr", label: "Avg HR", width: 100 },
  { id: "maxHr", label: "Max HR", width: 100 },
  { id: "sleep", label: "Sleep", width: 110 },
  { id: "rpe", label: "RPE (0–10)", width: 105 },
  { id: "effort", label: "Strava Relative Effort", width: 175 },
  { id: "painDuring", label: "ITB during", width: 120 },
  { id: "painNext", label: "ITB next morning", width: 145 },
  { id: "shoes", label: "Shoes", width: 155 },
  { id: "location", label: "Location", width: 185 },
  { id: "weatherStart", label: "Weather at start", width: 155 },
  { id: "weatherEnd", label: "Weather at finish", width: 155 },
  { id: "startTime", label: "Start time", width: 110 },
  { id: "endTime", label: "Finish time", width: 110 },
  { id: "notes", label: "Notes", width: 250 },
];
const initialColumns: ColumnId[] = ["name", "date", "distance", "pace", "avgHr", "painDuring"];
const widthsKey = "stride-run-history-widths-v1";
const columnsKey = "stride-run-history-columns-v1";

function clockPace(run: Run) {
  if (!(Number(run.distance) > 0) || !(Number(run.duration) > 0)) return "—";
  const seconds = Math.round(Number(run.duration) * 60 / Number(run.distance));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") + "/km";
}
function format(run: Run, id: ColumnId): string {
  switch (id) {
    case "name": return run.name || "Run";
    case "date": return run.date || "—";
    case "type": return run.type || "—";
    case "distance": return Number(run.distance || 0).toFixed(2) + " km";
    case "duration": {
      const seconds = Math.round(Number(run.duration || 0) * 60);
      return Math.floor(seconds / 3600) + "h " + String(Math.floor(seconds % 3600 / 60)).padStart(2, "0") + "m " + String(seconds % 60).padStart(2, "0") + "s";
    }
    case "pace": return clockPace(run);
    case "avgHr": return run.avgHr == null ? "—" : run.avgHr + " bpm";
    case "maxHr": return run.maxHr == null ? "—" : run.maxHr + " bpm";
    case "sleep": return run.sleep == null ? "—" : Math.floor(run.sleep) + "h " + String(Math.round((run.sleep % 1) * 60)).padStart(2, "0") + "m";
    case "rpe": return run.rpe == null ? "—" : String(run.rpe);
    case "effort": return run.effort == null ? "—" : String(run.effort);
    case "painDuring": return run.painDuring || (run.pain == null ? "—" : String(run.pain));
    case "painNext": return run.painNext || "—";
    case "shoes": return run.shoes || "—";
    case "location": return run.location || "—";
    case "weatherStart": return run.weatherStart || "—";
    case "weatherEnd": return run.weatherEnd || "—";
    case "startTime": return run.startTime || "—";
    case "endTime": return run.endTime || "—";
    case "notes": return run.notes || "—";
  }
}

export default function RunHistoryTable({
  runs,
  onSelect,
}: {
  runs: Run[];
  onSelect: (run: Run) => void;
}) {
  const [shown, setShown] = useState<ColumnId[]>(initialColumns);
  const [widths, setWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const [hydrated, setHydrated] = useState(false);
  const drag = useRef<{ id: ColumnId; x: number; width: number } | null>(null);

  useEffect(() => {
    try {
      const savedColumns = JSON.parse(localStorage.getItem(columnsKey) || "null") as unknown;
      if (Array.isArray(savedColumns)) {
        const valid = COLUMNS.map((column) => column.id).filter((id) => id === "name" || savedColumns.includes(id));
        if (valid.length) setShown(valid);
      }
      const savedWidths = JSON.parse(localStorage.getItem(widthsKey) || "{}") as Record<string, number>;
      const validWidths: Partial<Record<ColumnId, number>> = {};
      for (const column of COLUMNS) {
        const size = Number(savedWidths[column.id]);
        if (Number.isFinite(size) && size >= 80 && size <= 650) validWidths[column.id] = size;
      }
      setWidths(validWidths);
    } catch { /* Browser storage may be disabled. */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(columnsKey, JSON.stringify(shown)); } catch {}
  }, [shown, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(widthsKey, JSON.stringify(widths)); } catch {}
  }, [widths, hydrated]);

  const columns = COLUMNS.filter(({ id }) => shown.includes(id));
  const setColumn = (id: ColumnId, checked: boolean) => {
    if (id === "name") return;
    setShown((current) => {
      const desired = new Set(current);
      if (checked) desired.add(id); else desired.delete(id);
      return COLUMNS.map((column) => column.id).filter((key) => desired.has(key));
    });
  };
  const resize = (id: ColumnId, x: number) => {
    const current = drag.current;
    if (!current || current.id !== id) return;
    const width = Math.max(80, Math.min(650, current.width + x - current.x));
    setWidths((prev) => ({ ...prev, [id]: width }));
  };

  return <section className="run-history-table-wrap">
    <div className="history-table-tools">
      <span className="muted">{runs.length} runs · Scroll sideways for additional columns. Drag column edges to resize.</span>
      <details className="history-column-chooser">
        <summary className="btn">Columns ({columns.length})</summary>
        <div className="history-column-menu">
          <strong>Choose visible columns</strong>
          <p className="muted">RPE is your personal perceived effort (0–10), separate from Strava Relative Effort.</p>
          {COLUMNS.map(({ id, label }) => <label key={id}><input type="checkbox" checked={shown.includes(id)} disabled={id === "name"} onChange={(event) => setColumn(id, event.target.checked)}/><span>{label}</span></label>)}
          <button type="button" className="btn" onClick={() => { setShown(initialColumns); setWidths({}); }}>Reset columns and widths</button>
        </div>
      </details>
    </div>
    <div className="history-table-scroll" role="region" tabIndex={0} aria-label="Horizontally scrollable run history">
      <table className="history-custom-table">
        <colgroup>{columns.map((column) => <col key={column.id} style={{ width: widths[column.id] ?? column.width }}/>)}</colgroup>
        <thead><tr>{columns.map((column) => {
          const width = widths[column.id] ?? column.width;
          return <th key={column.id} scope="col" style={{ width }}>
            <span className="history-header-label">{column.label}</span>
            <span className="history-column-resizer" role="separator" tabIndex={0} aria-label={"Resize " + column.label} aria-orientation="vertical"
              onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation();
                drag.current = { id: column.id, x: event.clientX, width };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => { if (drag.current?.id === column.id) resize(column.id, event.clientX); }}
              onPointerUp={(event) => {
                if (drag.current?.id === column.id) resize(column.id, event.clientX);
                drag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { drag.current = null; }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                setWidths((prev) => ({ ...prev, [column.id]: Math.max(80, Math.min(650, (prev[column.id] ?? column.width) + (event.key === "ArrowRight" ? 15 : -15))) }));
              }}/>
          </th>;
        })}</tr></thead>
        <tbody>{runs.map((run, index) =>
          <tr key={run.id ?? run.date + "|" + run.name + "|" + index}>
            {columns.map((column) =>
              <td key={column.id} style={{ width: widths[column.id] ?? column.width }}>
                {column.id === "name"
                  ? <button type="button" className="run-name-button" title="View run details" onClick={() => onSelect(run)}><strong>{run.name || "Run"}</strong><span className="table-sub">{run.type}</span></button>
                  : <span title={format(run, column.id)}>{format(run, column.id)}</span>}
              </td>
            )}
          </tr>
        )}</tbody>
      </table>
      {!runs.length && <p className="empty">No runs match this view.</p>}
    </div>
  </section>;
}
