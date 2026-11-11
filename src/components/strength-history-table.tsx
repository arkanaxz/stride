"use client";

import { useEffect, useMemo, useState } from "react";
import type { Workout } from "@/lib/types";
import { STRENGTH_PAGE_SIZES, strengthWeekday, searchStrengthWorkouts, paginateStrengthWorkouts } from "@/lib/strength-history-utils";

type Column = { key: string; label: string; width: number; render: (workout: Workout) => string };
const duration = (mins?: number) => {
  if (!mins || mins <= 0) return "Not logged";
  const secs = Math.round(mins * 60);
  return Math.floor(secs / 3600) + ":" + String(Math.floor(secs % 3600 / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
};
const type = (w: Workout) => w.strengthLog?.type ||
  (w.session.includes("Strength B") ? "Strength B" : w.session.includes("Strength A") ? "Strength A" : "Strength / mobility");
const columns: Column[] = [
  { key: "date", label: "Date", width: 130, render: w => w.strengthLog?.date || w.date },
  { key: "session", label: "Workout", width: 200, render: w => w.strengthLog?.name || w.session },
  { key: "type", label: "Type", width: 130, render: type },
  { key: "duration", label: "Duration", width: 120, render: w => duration(w.strengthLog?.duration) },
  { key: "avgHr", label: "Avg HR", width: 100, render: w => w.strengthLog?.avgHr == null ? "—" : w.strengthLog.avgHr + " bpm" },
  { key: "maxHr", label: "Max HR", width: 100, render: w => w.strengthLog?.maxHr == null ? "—" : w.strengthLog.maxHr + " bpm" },
  { key: "sleep", label: "Sleep", width: 100, render: w => w.strengthLog?.sleep == null ? "—" : w.strengthLog.sleep.toFixed(2) + " h" },
  { key: "rpe", label: "RPE", width: 70, render: w => w.strengthLog?.rpe == null ? "—" : String(w.strengthLog.rpe) },
  { key: "painDuring", label: "ITB During", width: 100, render: w => w.strengthLog?.painDuring || "—" },
  { key: "painNext", label: "ITB Next", width: 100, render: w => w.strengthLog?.painNext || "—" },
  { key: "location", label: "Location", width: 180, render: w => w.strengthLog?.location || "—" },
  { key: "startTime", label: "Start Time", width: 115, render: w => w.strengthLog?.startTime || "—" },
  { key: "endTime", label: "End Time", width: 115, render: w => w.strengthLog?.endTime || "—" },
  { key: "weatherDuring", label: "Weather Notes", width: 175, render: w => w.strengthLog?.weatherDuring || "—" },
  { key: "exercises", label: "Exercises / Sets", width: 220, render: w => w.strengthLog?.exercises || "—" },
  { key: "notes", label: "Notes", width: 210, render: w => w.strengthLog?.notes || "—" },
];
const defaultKeys = ["date", "session", "duration", "rpe", "painDuring"];
const keysStorage = "stride-strength-history-columns-v1";
const widthsStorage = "stride-strength-history-widths-v1";

function savedKeys(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(keysStorage) || "null");
    if (Array.isArray(raw)) {
      const selected = raw.filter((key): key is string => typeof key === "string" && columns.some(c => c.key === key));
      if (selected.length) return selected;
    }
  } catch { /* Use defaults. */ }
  return defaultKeys;
}
function savedWidths(): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(widthsStorage) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([key, value]) =>
      columns.some(c => c.key === key) && typeof value === "number" && value >= 65 && value <= 700)) as Record<string, number>;
  } catch { return {}; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Remains usable without storage. */ }
}
export default function StrengthHistoryTable({ workouts, isAdmin, onOpen }: {
  workouts: Workout[];
  isAdmin: boolean;
  onOpen: (workout: Workout) => void;
}) {
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [keys, setKeys] = useState<string[]>(defaultKeys);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [columnsOpen, setColumnsOpen] = useState(false);
  useEffect(() => { setKeys(savedKeys()); setWidths(savedWidths()); }, []);

  const filtered = useMemo(() => searchStrengthWorkouts(workouts, query), [workouts, query]);
  const view = paginateStrengthWorkouts(filtered, pageSize, page);
  const shownColumns = useMemo(() => columns.filter(c => keys.includes(c.key)), [keys]);
  const width = (c: Column) => widths[c.key] ?? c.width;

  function toggle(key: string) {
    const updated = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
    if (updated.length === 0) return;
    setKeys(updated); store(keysStorage, updated);
  }
  function resize(key: string, value: number) {
    setWidths(current => {
      const updated = { ...current, [key]: Math.max(65, Math.min(700, Math.round(value))) };
      store(widthsStorage, updated);
      return updated;
    });
  }
  return <div className="strength-history-ui">
    <div className="history-controls strength-history-controls">
      <input className="run-search" type="search" aria-label="Search strength workout history"
        placeholder="Search strength workouts" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }}/>
      <label className="compact-field">Show
        <select aria-label="Strength rows per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
          {STRENGTH_PAGE_SIZES.map(size => <option value={size} key={size}>{size}</option>)}
        </select>
      </label>
      <button type="button" className="btn" disabled={view.page === 0}
        onClick={() => setPage(Math.max(0, view.page - 1))}>Previous</button>
      <span aria-live="polite">Page {view.page + 1} / {view.pageCount}</span>
      <button type="button" className="btn" disabled={view.page + 1 >= view.pageCount}
        onClick={() => setPage(Math.min(view.pageCount - 1, view.page + 1))}>Next</button>
    </div>
    <div className="history-column-controls">
      <button className="btn" type="button" aria-expanded={columnsOpen} aria-controls="strength-column-picker"
        onClick={() => setColumnsOpen(open => !open)}>{columnsOpen ? "Hide columns" : "Choose columns"}</button>
      <span className="muted">Drag column edges to resize · Scroll sideways for more metrics</span>
    </div>
    {columnsOpen && <div className="history-column-picker" id="strength-column-picker">
      {columns.map(c => <label key={c.key}><input type="checkbox" checked={keys.includes(c.key)} onChange={() => toggle(c.key)}/>{c.label}</label>)}
      <button type="button" className="btn" onClick={() => {
        setKeys(defaultKeys); setWidths({});
        try { localStorage.removeItem(keysStorage); localStorage.removeItem(widthsStorage); } catch { /* ignore */ }
      }}>Reset layout</button>
    </div>}
    <div className="history-table-scroll" role="region" tabIndex={0} aria-label="Scrollable strength history table">
      <table className="custom-run-table" style={{ width: shownColumns.reduce((sum, c) => sum + width(c), isAdmin ? 175 : 0), minWidth: "100%" }}>
        <colgroup>{shownColumns.map(c => <col key={c.key} style={{ width: width(c) }}/>)}
          {isAdmin && <col style={{ width: 175 }}/>}</colgroup>
        <thead><tr>{shownColumns.map(c => <th scope="col" key={c.key}>
          <span>{c.label}</span>
          <span className="column-resize" role="separator" aria-label={"Resize " + c.label}
            title="Drag to resize" onPointerDown={event => {
              event.preventDefault();
              const target = event.currentTarget;
              const start = event.clientX;
              const initial = width(c);
              target.setPointerCapture(event.pointerId);
              const move = (event: PointerEvent) => resize(c.key, initial + event.clientX - start);
              const stop = () => {
                target.removeEventListener("pointermove", move);
                target.removeEventListener("pointerup", stop);
                target.removeEventListener("pointercancel", stop);
              };
              target.addEventListener("pointermove", move);
              target.addEventListener("pointerup", stop);
              target.addEventListener("pointercancel", stop);
            }}/>
        </th>)}
          {isAdmin && <th scope="col">Details</th>}
        </tr></thead>
        <tbody>{view.rows.map(w => <tr key={String(w.id)}>
          {shownColumns.map(c => {
            const value = c.render(w);
            return <td key={c.key}>{c.key === "date"
              ? <span className="history-date-cell"><strong>{value}</strong><small className="table-sub">{strengthWeekday(value)}</small></span>
              : c.key === "session" && isAdmin
                ? <button className="run-name-button" type="button" onClick={() => onOpen(w)}>
                  <strong>{value}</strong><small className="table-sub">{type(w)}</small>
                </button>
                : <span title={value}>{value}</span>}
            </td>;
          })}
          {isAdmin && <td><button type="button" className="btn" onClick={() => onOpen(w)}>
            {w.strengthLog ? "View / edit details" : "Add workout details"}
          </button></td>}
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="empty">{workouts.length
        ? "No strength sessions match your search."
        : "Completed strength sessions will appear here. Select Log as done to enter details."}</p>}
    </div>
    <p className="muted strength-history-count">
      {view.total ? "Showing " + (view.start + 1) + "–" + view.end + " of " + view.total + " strength sessions" : "Showing 0 strength sessions"}
      {query.trim() && " · Filtered from " + workouts.length + " completed sessions"}
    </p>
  </div>;
}
