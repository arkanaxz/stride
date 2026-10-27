"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Bundle, Preferences, Run, Workout } from "@/lib/types";

declare global { interface Window { STRIDE_DEFAULTS?: { runs?: Run[]; plan?: Workout[]; meta?: Record<string, string> } } }

const initialPreferences: Preferences = { defaultLocation: "Lapu-Lapu City, Cebu, Philippines", theme: "dark", raceDate: "2027-03-14", planRowCount: 1, provider: "openai", model: "gpt-6-luna" };
const modelOptions: Record<Preferences["provider"], [string, string][]> = {
  openai: [["gpt-6-luna", "GPT-6 Luna"], ["gpt-5.6-terra", "GPT-5.6 Terra"], ["gpt-5.6-luna", "GPT-5.6 Luna"]],
  gemini: [["gemini-3.8-flash", "Gemini 3.8 Flash"], ["gemini-3.7-flash", "Gemini 3.7 Flash"], ["gemini-3.6-flash", "Gemini 3.6 Flash"], ["gemini-3.5-flash", "Gemini 3.5 Flash"], ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"], ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"], ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"], ["gemini-3-flash-preview", "Gemini 3 Flash Preview"], ["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"], ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"]],
  anthropic: [["claude-sonnet-5-5", "Claude Sonnet"], ["claude-opus-5", "Claude Opus"], ["claude-haiku-4-5", "Claude Haiku"]],
};

function localState(): Partial<Bundle> {
  const parse = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
  return {
    runs: parse("stride-runs-v1", window.STRIDE_DEFAULTS?.runs || []),
    plan: parse("stride-training-plan", window.STRIDE_DEFAULTS?.plan || []),
    meta: { ...(window.STRIDE_DEFAULTS?.meta || {}), ...parse("stride-training-meta", {}) },
    preferences: { ...initialPreferences, defaultLocation: localStorage.getItem("stride-default-location") || initialPreferences.defaultLocation, raceDate: localStorage.getItem("stride-race-date") || initialPreferences.raceDate, planRowCount: Number(localStorage.getItem("stride-plan-row-count") || 1), theme: (localStorage.getItem("stride-theme") as Preferences["theme"]) || "dark" },
  };
}

function isoToday() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function pace(run: Run) { if (!run.distance || !run.duration) return "—"; const minutes = run.duration / run.distance; return `${Math.floor(minutes)}:${String(Math.round(minutes % 1 * 60)).padStart(2, "0")}`; }
function friendlyDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options) : "—"; }
function durationLabel(minutes: number) { const total = Math.round(minutes); return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`; }
function trainingDate(workout: Workout, raceDate: string) {
  const shift = raceDate === "2027-03-07" && workout.dateShiftable !== false ? -7 : 0;
  const date = new Date(`${workout.date}T12:00:00`);
  date.setDate(date.getDate() + shift);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [bundle, setBundle] = useState<Bundle>({ runs: [], plan: [], meta: {}, preferences: initialPreferences, storage: "SQLite" });
  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "year" | "all">("week");
  const [rangeShift, setRangeShift] = useState(0);
  const [chartMode, setChartMode] = useState<"week" | "month">("week");
  const [chartShift, setChartShift] = useState(0);
  const [showFullPlan, setShowFullPlan] = useState(false);
  const [workoutLimit, setWorkoutLimit] = useState(1);
  const [status, setStatus] = useState("Loading your running data…");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [undoWorkout, setUndoWorkout] = useState<{ index: number; status: string } | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [analysisRunId, setAnalysisRunId] = useState("");
  const [analysisKey, setAnalysisKey] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the database.");
        const existing = await response.json() as Bundle;
        let loaded = existing;
        if (!localStorage.getItem("stride-db-migrated")) {
          const migrated = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "bootstrap", ...localState() }) });
          if (!migrated.ok) throw new Error("Could not migrate your existing browser data into the connected database.");
          loaded = await migrated.json() as Bundle;
          localStorage.setItem("stride-db-migrated", "true");
        }
        if (active) {
          const availableModels = modelOptions[loaded.preferences.provider];
          const model = availableModels.some(([id]) => id === loaded.preferences.model) ? loaded.preferences.model : availableModels[0][0];
          setBundle({ ...loaded, preferences: { ...loaded.preferences, model } });
          setWorkoutLimit(loaded.preferences.planRowCount || 1);
          setStatus("");
          setReady(true);
          document.documentElement.dataset.theme = loaded.preferences.theme || "dark";
        }
      } catch (reason) { if (active) { setStatus(reason instanceof Error ? reason.message : "Database unavailable."); setError("Could not connect to Stride’s database. Check the server and database configuration, then refresh."); } }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => { setToast(""); setUndoWorkout(null); }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function persist(next: Bundle, message = `Saved to ${next.storage === "Turso" ? "Turso" : "local SQLite"}`) {
    setBundle(next);
    const response = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    if (!response.ok) { setError("Could not save changes to the database."); return false; }
    const saved = await response.json() as Bundle;
    setBundle(saved);
    setToast(message);
    return true;
  }

  const visibleRuns = useMemo(() => {
    const now = new Date(`${isoToday()}T12:00:00`);
    let start = new Date(now);
    if (period === "week") { start.setDate(now.getDate() - ((now.getDay() + 6) % 7) + rangeShift * 7); const end = new Date(start); end.setDate(start.getDate() + 6); return bundle.runs.filter((run) => { const day = new Date(`${run.date}T12:00:00`); return day >= start && day <= end; }); }
    if (period === "month") start = new Date(now.getFullYear(), now.getMonth() + rangeShift, 1);
    if (period === "quarter") start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + rangeShift * 3, 1);
    if (period === "year") start = new Date(now.getFullYear() + rangeShift, 0, 1);
    return period === "all" ? bundle.runs : bundle.runs.filter((run) => new Date(`${run.date}T12:00:00`) >= start && new Date(`${run.date}T12:00:00`) < (period === "month" ? new Date(start.getFullYear(), start.getMonth() + 1, 1) : period === "quarter" ? new Date(start.getFullYear(), start.getMonth() + 3, 1) : new Date(start.getFullYear() + 1, 0, 1)));
  }, [bundle.runs, period, rangeShift]);

  const totals = useMemo(() => {
    const distance = visibleRuns.reduce((sum, run) => sum + Number(run.distance || 0), 0);
    const duration = visibleRuns.reduce((sum, run) => sum + Number(run.duration || 0), 0);
    const heart = visibleRuns.filter((run) => Number(run.avgHr) > 0);
    const averageHr = heart.length ? Math.round(heart.reduce((sum, run) => sum + Number(run.avgHr), 0) / heart.length) : 0;
    const maxHr = Math.max(0, ...visibleRuns.map((run) => Number(run.maxHr || 0)));
    return { distance, duration, averageHr, maxHr, averagePace: distance ? pace({ distance, duration } as Run) : "—" };
  }, [visibleRuns]);

  const shoes = useMemo(() => [...new Set(bundle.runs.map((run) => run.shoes || "Unspecified"))].sort(), [bundle.runs]);
  const chart = useMemo(() => {
    const today = new Date(`${isoToday()}T12:00:00`);
    const monthlyStart = new Date(today.getFullYear(), today.getMonth() + chartShift, 1);
    const mondayOffset = (monthlyStart.getDay() + 6) % 7;
    const start = chartMode === "week" ? new Date(today) : new Date(monthlyStart);
    if (chartMode === "week") start.setDate(today.getDate() - ((today.getDay() + 6) % 7) + chartShift * 7);
    else start.setDate(monthlyStart.getDate() - mondayOffset);
    const bins = chartMode === "week" ? 7 : Math.ceil((new Date(monthlyStart.getFullYear(), monthlyStart.getMonth() + 1, 0).getDate() + mondayOffset) / 7);
    const days = Array.from({ length: bins }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index * (chartMode === "week" ? 1 : 7));
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const dayEnd = new Date(date); dayEnd.setDate(date.getDate() + (chartMode === "week" ? 1 : 7));
      const runs = bundle.runs.filter((run) => {
        const day = new Date(`${run.date}T12:00:00`);
        if (chartMode === "week") return run.date === dateKey;
        return day >= monthlyStart && day < new Date(monthlyStart.getFullYear(), monthlyStart.getMonth() + 1, 1) && day >= date && day < dayEnd;
      });
      const distance = runs.reduce((sum, run) => sum + Number(run.distance || 0), 0);
      const duration = runs.reduce((sum, run) => sum + Number(run.duration || 0), 0);
      const hr = runs.filter((run) => Number(run.avgHr) > 0);
      const label = chartMode === "week" ? date.toLocaleDateString(undefined, { weekday: "long" }) : `Week ${index + 1}`;
      return { label, dateKey, distance, pace: distance ? pace({ distance, duration } as Run) : "—", hr: hr.length ? Math.round(hr.reduce((sum, run) => sum + Number(run.avgHr), 0) / hr.length) : null };
    });
    const max = Math.max(5, ...days.map((day) => day.distance));
    return days.map((day, index) => ({ ...day, x: 38 + index * 602 / Math.max(1, days.length - 1), y: 182 - day.distance / (max * 1.12) * 148 }));
  }, [bundle.runs, chartMode, chartShift]);

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const run: Run = { date: String(form.get("date")), name: String(form.get("name")), type: String(form.get("type")), distance: Number(form.get("distance")), duration: Number(form.get("duration")), avgHr: Number(form.get("avgHr")) || null, maxHr: Number(form.get("maxHr")) || null, sleep: Number(form.get("sleep")) || null, painDuring: String(form.get("painDuring")), painNext: String(form.get("painNext")), pain: Number(form.get("pain")) || 0, effort: Number(form.get("effort")) || null, shoes: String(form.get("shoes")), location: String(form.get("location")), startTime: String(form.get("startTime")), weatherStart: String(form.get("weatherStart")), weatherEnd: String(form.get("weatherEnd")), weatherDuring: String(form.get("weatherDuring")), notes: String(form.get("notes")) };
    await persist({ ...bundle, runs: [...bundle.runs, run] }, `Run saved to ${bundle.storage === "Turso" ? "Turso" : "your local database"}`);
    formElement.reset(); setRunDialog(false);
  }

  async function addWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const workout: Workout = { id: crypto.randomUUID(), date: String(form.get("date")), week: Number(form.get("week")) || 0, phase: String(form.get("phase")), session: String(form.get("session")), target: String(form.get("target")), pace: String(form.get("pace")), hr: String(form.get("hr")), status: "planned" };
    await persist({ ...bundle, plan: [...bundle.plan, workout].sort((a, b) => a.date.localeCompare(b.date)) }, "Workout added to your training block");
    formElement.reset();
  }

  async function updateWorkout(workout: Workout, status: string) {
    const index = bundle.plan.indexOf(workout);
    if (index < 0) return;
    const previousStatus = workout.status || "planned";
    const saved = await persist({ ...bundle, plan: bundle.plan.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item) }, status === "completed" ? "Workout marked done" : "Workout marked planned");
    if (saved && status === "completed") setUndoWorkout({ index, status: previousStatus });
  }

  async function importFile(file?: File) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setBundle(result); setToast(`Imported ${result.importedRuns} runs and ${result.importedWorkouts} workouts`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); }
    finally { setUploading(false); }
  }

  function exportCsv() {
    const keys: (keyof Run)[] = ["date", "name", "type", "distance", "duration", "avgHr", "maxHr", "sleep", "painDuring", "painNext", "effort", "weatherStart", "weatherEnd", "weatherDuring", "location", "startTime", "shoes", "notes"];
    const quote = (value: unknown) => { const item = String(value ?? ""); return /[",\n\r]/.test(item) ? `"${item.replaceAll('"', '""')}"` : item; };
    const csv = [keys.join(","), ...bundle.runs.map((run) => keys.map((key) => quote(run[key])).join(","))].join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "stride-runs.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  async function analyzeRun() {
    const run = bundle.runs.find((item) => String(item.id ?? item.date + item.name) === analysisRunId) || bundle.runs[0];
    if (!run) { setError("Log or import a run before requesting analysis."); return; }
    if (!analysisKey.trim()) { setError("Enter your provider API key for this request. The key is not saved."); return; }
    setAnalyzing(true); setAnalysis("Sending run details to your selected provider…"); setError("");
    const provider = bundle.preferences.provider;
    const paceText = pace(run);
    const prompt = `You are a direct, evidence-based running coach. Give honest, specific, unsugar-coated but constructive feedback. Do not diagnose injuries. Distinguish facts from uncertainty.\n\nRun: ${JSON.stringify({ ...run, pace: `${paceText} min/km` })}\n\nBe concise: what went well, what needs attention, ITB/recovery signal, next-session recommendation.`;
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model: bundle.preferences.model, apiKey: analysisKey, prompt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Analysis request failed.");
      setAnalysis(result.answer || "No response text was returned.");
    } catch (reason) { setAnalysis(""); setError(reason instanceof Error ? reason.message : "Analysis failed."); }
    finally { setAnalyzing(false); }
  }

  async function savePreferences(next: Preferences) {
    document.documentElement.dataset.theme = next.theme;
    localStorage.setItem("stride-default-location", next.defaultLocation);
    localStorage.setItem("stride-race-date", next.raceDate);
    localStorage.setItem("stride-plan-row-count", String(next.planRowCount));
    localStorage.setItem("stride-theme", next.theme);
    await persist({ ...bundle, preferences: next }, "Settings saved to SQLite");
  }

  async function renameShoes(names: Record<string, string>) {
    const updated = bundle.runs.map((run) => {
      const oldName = run.shoes || "Unspecified";
      const newName = names[oldName]?.trim();
      return newName && newName !== oldName ? { ...run, shoes: newName } : run;
    });
    await persist({ ...bundle, runs: updated }, "Shoe names saved");
  }

  async function updateRun(run: Run, updates: Partial<Run>) {
    const target = run.id ?? `${run.date}|${run.name}`;
    await persist({ ...bundle, runs: bundle.runs.map((item) => (item.id ?? `${item.date}|${item.name}`) === target ? { ...item, ...updates } : item) }, "Run details saved");
  }

  if (!ready) return <main className="loading"><div className="brand-mark">↗</div><h1>Stride</h1><p>{status}</p>{error && <p className="error">{error}</p>}</main>;

  const upcoming = bundle.plan.filter((workout) => workout.status !== "completed" && trainingDate(workout, bundle.preferences.raceDate) >= isoToday()).sort((a, b) => trainingDate(a, bundle.preferences.raceDate).localeCompare(trainingDate(b, bundle.preferences.raceDate)));
  const sortedRuns = [...visibleRuns].sort((a, b) => b.date.localeCompare(a.date));
  const runsForAnalysis = [...bundle.runs].sort((a, b) => b.date.localeCompare(a.date));
  const selectedWorkoutRows = (showFullPlan ? [...bundle.plan].sort((a, b) => trainingDate(a, bundle.preferences.raceDate).localeCompare(trainingDate(b, bundle.preferences.raceDate))) : upcoming).slice(0, workoutLimit);
  const periodLabel = period === "all" ? "All time" : period === "week" ? "This week" : period === "quarter" ? "This quarter" : period === "year" ? "This year" : "This month";
  const startPoint = chart[0], endPoint = chart[chart.length - 1];
  const chartMonth = new Date(); chartMonth.setDate(1); chartMonth.setMonth(chartMonth.getMonth() + chartShift);
  const chartLabel = chartMode === "week" ? `${friendlyDate(startPoint.dateKey)} – ${friendlyDate(new Date(`${endPoint.dateKey}T12:00:00`).toISOString().slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}` : chartMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const line = chart.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${chart[0].x},190 ${line} ${chart[6].x},190`;
  const plannedCount = bundle.plan.length;
  const completedCount = bundle.plan.filter((workout) => workout.status === "completed").length;

  return <main className="shell">
    <header className="topbar"><a className="brand" href="#dashboard" onClick={(event) => { event.preventDefault(); setPage("dashboard"); }}><span className="brand-mark">↗</span><span>stride<span className="lime">.</span></span></a><nav className="main-nav"><button className={page === "dashboard" ? "nav-link active" : "nav-link"} onClick={() => setPage("dashboard")}>Dashboard</button><button className={page === "settings" ? "nav-link active" : "nav-link"} onClick={() => setPage("settings")}>Settings</button></nav><div className="top-actions"><label className="btn upload-btn">{uploading ? "Importing…" : "Import Excel / CSV"}<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} hidden /></label><button className="btn" onClick={exportCsv}>Export CSV</button><button className="btn primary" onClick={() => setRunDialog(true)}>＋ Log a run</button></div></header>
    {error && <div className="notice error">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    {page === "dashboard" ? <>
      <section className="hero"><div><div className="eyebrow">YOUR TRAINING, IN STRIDE</div><h1>Run dashboard</h1><div className="muted">A clear view of your training, recovery, and progress.</div></div><div className="hero-right"><div className="periods">{(["week", "month", "quarter", "year", "all"] as const).map((item) => <button key={item} className={period === item ? "period active" : "period"} onClick={() => { setPeriod(item); setRangeShift(0); }}>{item === "all" ? "All time" : item}</button>)}</div></div></section>
      <section className="card training-card"><div className="card-head"><div><div className="eyebrow">TRAINING BLOCK</div><h2>{bundle.meta.title || "SM2SM 2027 Half Marathon"}</h2><div className="muted">{plannedCount} planned sessions · {completedCount} completed · Goal {bundle.meta.goalFinish || "1:44:59"}</div></div><div className="plan-actions"><label className="compact-field">Race date<select value={bundle.preferences.raceDate} onChange={(event) => void savePreferences({ ...bundle.preferences, raceDate: event.target.value })}><option value="2027-03-14">Mar 14, 2027</option><option value="2027-03-07">Mar 7, 2027</option></select></label><label className="compact-field">Show<select value={workoutLimit} onChange={(event) => { setWorkoutLimit(Number(event.target.value)); void savePreferences({ ...bundle.preferences, planRowCount: Number(event.target.value) }); }}>{[1, 5, 10, 20, 50, 100].map((count) => <option key={count}>{count}</option>)}</select></label><button className="btn" onClick={() => setShowFullPlan(!showFullPlan)}>{showFullPlan ? "Upcoming only" : "Include past & completed"}</button></div></div><div className="progress-row"><div className="track"><div className="fill" style={{ width: `${plannedCount ? completedCount / plannedCount * 100 : 0}%` }} /></div><span>{plannedCount ? Math.round(completedCount / plannedCount * 100) : 0}%</span></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Week / phase</th><th>Planned workout</th><th>Target</th><th>Status</th></tr></thead><tbody>{selectedWorkoutRows.length ? selectedWorkoutRows.map((workout, index) => <tr key={workout.id ?? `${workout.date}|${workout.session}|${index}`}><td>{friendlyDate(trainingDate(workout, bundle.preferences.raceDate), { month: "short", day: "numeric", weekday: "short" })}</td><td>{workout.phase || `Week ${workout.week}`}</td><td><strong>{workout.session}</strong></td><td>{workout.target || workout.pace || "As written"}</td><td><button className={workout.status === "completed" ? "status done" : "status"} onClick={() => void updateWorkout(workout, workout.status === "completed" ? "planned" : "completed")}>{workout.status === "completed" ? "Completed" : "Mark done"}</button></td></tr>) : <tr><td colSpan={5} className="empty">No planned workouts yet. Add one below or import your training workbook.</td></tr>}</tbody></table></div><details className="add-workout"><summary>＋ Add a workout to this training block</summary><form className="workout-form" onSubmit={(event) => void addWorkout(event)}><input name="date" type="date" required defaultValue={isoToday()} /><input name="week" type="number" min="0" placeholder="Week"/><input name="phase" placeholder="Training phase"/><input name="session" placeholder="Workout description" required/><input name="target" placeholder="Target duration / distance"/><input name="pace" placeholder="Pace target"/><input name="hr" placeholder="Heart-rate guidance"/><button className="btn primary">Add workout</button></form></details></section>
      <section className="stats-grid">{[["Distance", `${totals.distance.toFixed(1)} km`, `${visibleRuns.length} runs · ${periodLabel}`],["Duration", durationLabel(totals.duration), "Total running time"],["Average heart rate", totals.averageHr ? `${totals.averageHr} bpm` : "—", `Maximum ${totals.maxHr || "—"} bpm`],["Average pace", totals.averagePace === "—" ? "—" : `${totals.averagePace} /km`, "Distance-weighted"]].map(([label, value, note]) => <article className="card stat" key={label}><div className="muted">{label}</div><strong>{value}</strong><small>{note}</small></article>)}</section>
      <section className="two-columns"><article className="card"><div className="card-head"><div><h2>Distance over time</h2><p className="muted">{chartMode === "week" ? "Full Monday–Sunday weeks" : "Weekly totals for the selected month"} · Hover for pace and HR.</p></div><div className="chart-nav"><select aria-label="Chart period" value={chartMode} onChange={(event) => { setChartMode(event.target.value as "week" | "month"); setChartShift(0); }}><option value="week">Weekly</option><option value="month">Monthly</option></select><button className="btn" aria-label={chartMode === "week" ? "Previous week" : "Previous month"} onClick={() => setChartShift((value) => value - 1)}>‹</button><span>{chartLabel}</span><button className="btn" aria-label={chartMode === "week" ? "Next week" : "Next month"} onClick={() => setChartShift((value) => value + 1)}>›</button></div></div><div className="chart"><svg viewBox="0 0 640 220" role="img" aria-label="Running distance chart"><line className="gridline" x1="38" y1="40" x2="640" y2="40"/><line className="gridline" x1="38" y1="110" x2="640" y2="110"/><line className="gridline" x1="38" y1="190" x2="640" y2="190"/><polygon points={area} className="chart-area"/><polyline points={line} className="chart-line"/>{chart.map((point) => <g className="chart-point" key={point.dateKey}><circle cx={point.x} cy={point.y} r="6"/><text x={point.x} y="213" textAnchor="middle">{point.label}</text><title>{`${point.label}: ${point.distance.toFixed(2)} km · ${point.pace} min/km · ${point.hr ? `${point.hr} bpm` : "No HR"}`}</title><foreignObject x={point.x - 42} y={point.y - 72} width="150" height="64"><div className="chart-tooltip"><b>{point.label}</b><span>{point.distance.toFixed(2)} km</span><span>Avg pace: {point.pace}</span><span>Avg HR: {point.hr ? `${point.hr} bpm` : "—"}</span></div></foreignObject></g>)}</svg></div></article><article className="card"><h2>Run Review</h2><p className="muted">Honest feedback from your chosen AI provider.</p><div className="review-controls"><label>Provider<select value={bundle.preferences.provider} onChange={(event) => { const provider = event.target.value as Preferences["provider"]; void persist({ ...bundle, preferences: { ...bundle.preferences, provider, model: modelOptions[provider][0][0] } }); }}><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Google Gemini</option><option value="anthropic">Claude</option></select></label><label>Model<select value={bundle.preferences.model} onChange={(event) => void persist({ ...bundle, preferences: { ...bundle.preferences, model: event.target.value } })}>{modelOptions[bundle.preferences.provider].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Run<select value={analysisRunId || String(runsForAnalysis[0]?.id ?? "")} onChange={(event) => setAnalysisRunId(event.target.value)}>{runsForAnalysis.map((run, index) => <option key={run.id ?? `${run.date}-${index}`} value={String(run.id ?? run.date + run.name)}>{friendlyDate(run.date)} · {run.name} · {run.distance} km</option>)}</select></label><label>API key<input type="password" value={analysisKey} onChange={(event) => setAnalysisKey(event.target.value)} placeholder="Used once; not saved" autoComplete="off"/></label></div><p className="consent">Your selected provider receives this run’s details for analysis. Your API key is sent only to the Stride server for this request and is not stored. Weather stays manual.</p><button className="btn primary" disabled={analyzing || !bundle.runs.length} onClick={() => void analyzeRun()}>{analyzing ? "Analyzing…" : "Analyze this run"}</button>{analysis && <div className="analysis-result">{analysis}</div>}</article></section>
      <section className="two-columns"><article className="card"><div className="card-head"><div><h2>Run history</h2><p className="muted">Recent sessions in the selected time range</p></div></div><div className="table-wrap"><table><thead><tr><th>Run</th><th>Date</th><th>Distance</th><th>Pace</th><th>Avg HR</th><th>ITB</th></tr></thead><tbody>{sortedRuns.slice(0, 12).map((run, index) => <tr key={run.id ?? `${run.date}-${index}`}><td><strong>{run.name}</strong><small className="table-sub">{run.type}</small></td><td>{friendlyDate(run.date)}</td><td>{Number(run.distance).toFixed(2)} km</td><td>{pace(run)}</td><td>{run.avgHr || "—"}</td><td>{run.painDuring || run.pain || "—"} / {run.painNext || "—"}</td></tr>)}</tbody></table>{!sortedRuns.length && <p className="empty">No runs yet. Add a run or import your workbook.</p>}</div></article><article className="card"><h2>Shoe rotation</h2><p className="muted">Mileage based on your complete run log</p>{shoes.map((shoe) => <div className="shoe-row" key={shoe}><span className="shoe-icon">👟</span><strong>{shoe}</strong><span>{bundle.runs.filter((run) => (run.shoes || "Unspecified") === shoe).reduce((sum, run) => sum + Number(run.distance || 0), 0).toFixed(1)} km</span></div>)}{!shoes.length && <p className="empty">Mileage appears after your first run.</p>}</article></section>
    </> : <Settings bundle={bundle} shoes={shoes} onSave={savePreferences} onRename={renameShoes} onUpdateRun={updateRun} onToast={setToast} />}
    <div className="account-actions"><span>Private account</span><form method="post" action="/api/auth/logout"><button className="btn" type="submit">Sign out</button></form></div>
    <footer>Stride keeps your run log in your connected database. Your login is required to access the dashboard.</footer>
    {toast && <div className="toast">{toast}{undoWorkout && <button onClick={() => { const undo = undoWorkout; setUndoWorkout(null); void persist({ ...bundle, plan: bundle.plan.map((item, index) => index === undo.index ? { ...item, status: undo.status } : item) }, "Workout status restored"); }}>Undo</button>}</div>}
    {runDialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRunDialog(false); }}><form className="modal card" onSubmit={(event) => void submitRun(event)}><div className="modal-head"><div><div className="eyebrow">RUN LOG</div><h2>Log a run</h2></div><button type="button" className="btn" onClick={() => setRunDialog(false)}>Close</button></div><div className="run-form"><label>Date<input type="date" name="date" required defaultValue={isoToday()}/></label><label>Run name<input name="name" required placeholder="Easy run"/></label><label>Type<select name="type"><option>Easy</option><option>Long</option><option>Tempo</option><option>Intervals</option><option>Recovery</option><option>Race</option><option>Other</option></select></label><label>Distance (km)<input type="number" name="distance" min="0.1" step="0.01" required/></label><label>Duration (minutes)<input type="number" name="duration" min="1" step="0.01" required/></label><label>Average HR<input type="number" name="avgHr" min="1"/></label><label>Maximum HR<input type="number" name="maxHr" min="1"/></label><label>Sleep (hours)<input type="number" name="sleep" min="0" max="24" step="0.1"/></label><label>Relative effort<input type="number" name="effort" min="0"/></label><label>ITB during run (0–10)<input name="painDuring" placeholder="0"/></label><label>ITB next morning (0–10)<input name="painNext" placeholder="0"/></label><label>Shoes<input name="shoes" list="shoe-options"/><datalist id="shoe-options">{shoes.map((shoe) => <option key={shoe}>{shoe}</option>)}</datalist></label><label>Run location<input name="location" required defaultValue={bundle.preferences.defaultLocation}/></label><label>Start time<input type="time" name="startTime"/></label><label>Weather at start<input name="weatherStart" placeholder="Manual entry"/></label><label>Weather at finish<input name="weatherEnd" placeholder="Manual entry"/></label><label className="span-two">Weather during the run<textarea name="weatherDuring" placeholder="Manual conditions or temperature changes"/></label><label className="span-two">Notes<textarea name="notes"/></label></div><div className="modal-foot"><small>All run information is required where indicated. Weather and location are manual.</small><button className="btn primary">Save run</button></div></form></div>}
  </main>;
}

function Settings({ bundle, shoes, onSave, onRename, onUpdateRun, onToast }: { bundle: Bundle; shoes: string[]; onSave: (preferences: Preferences) => Promise<void>; onRename: (names: Record<string, string>) => Promise<void>; onUpdateRun: (run: Run, updates: Partial<Run>) => Promise<void>; onToast: (message: string) => void }) {
  const [prefs, setPrefs] = useState(bundle.preferences);
  const [shoeNames, setShoeNames] = useState<Record<string, string>>(() => Object.fromEntries(shoes.map((shoe) => [shoe, shoe])));
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState("");
  const [runValues, setRunValues] = useState({ location: "", startTime: "", weatherStart: "", weatherEnd: "", weatherDuring: "", notes: "" });
  useEffect(() => { setPrefs(bundle.preferences); }, [bundle.preferences]);
  useEffect(() => { setShoeNames(Object.fromEntries(shoes.map((shoe) => [shoe, shoe]))); }, [shoes]);
  const sortedRuns = [...bundle.runs].sort((a, b) => b.date.localeCompare(a.date));
  const activeRun = sortedRuns.find((run, index) => String(run.id ?? index) === selectedRun) || sortedRuns[0];
  useEffect(() => { if (activeRun) setRunValues({ location: activeRun.location || "", startTime: activeRun.startTime || "", weatherStart: activeRun.weatherStart || "", weatherEnd: activeRun.weatherEnd || "", weatherDuring: activeRun.weatherDuring || "", notes: activeRun.notes || "" }); }, [activeRun?.id, activeRun?.date, activeRun?.name, activeRun?.location, activeRun?.startTime, activeRun?.weatherStart, activeRun?.weatherEnd, activeRun?.weatherDuring, activeRun?.notes]);
  return <section className="settings-page"><div className="hero"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p className="muted">Manage training preferences, shoe names, and run details.</p></div></div><div className="settings-grid"><article className="card"><h2>General</h2><p className="muted">{bundle.storage === "Turso" ? "Synced to your connected Turso cloud database." : "Saved in a local SQLite database."}</p><div className="settings-form"><label>Default run location<input value={prefs.defaultLocation} onChange={(event) => setPrefs({ ...prefs, defaultLocation: event.target.value })}/></label><label>Appearance<select value={prefs.theme} onChange={(event) => setPrefs({ ...prefs, theme: event.target.value as Preferences["theme"] })}><option value="dark">Dark mode</option><option value="light">Light mode</option></select></label><label>Likely race date<select value={prefs.raceDate} onChange={(event) => setPrefs({ ...prefs, raceDate: event.target.value })}><option value="2027-03-14">March 14, 2027</option><option value="2027-03-07">March 7, 2027</option></select></label><label>Training block rows<select value={prefs.planRowCount} onChange={(event) => setPrefs({ ...prefs, planRowCount: Number(event.target.value) })}>{[1, 5, 10, 20, 50, 100].map((number) => <option key={number}>{number}</option>)}</select></label></div><button className="btn primary" onClick={() => void onSave(prefs)}>Save preferences</button></article><article className="card"><h2>Shoe rotation</h2><p className="muted">Rename a shoe and the change applies to all matching runs.</p>{shoes.map((shoe) => <label className="shoe-edit" key={shoe}><span>👟</span><input aria-label={`Shoe name ${shoe}`} value={shoeNames[shoe] ?? shoe} onChange={(event) => setShoeNames({ ...shoeNames, [shoe]: event.target.value })}/></label>)}{!shoes.length && <p className="empty">Log a run to add a shoe.</p>}<button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onRename(shoeNames); setBusy(false); onToast("Shoe names saved"); }}>{busy ? "Saving…" : "Save shoe names"}</button></article><article className="card run-edit-card"><h2>Edit logged run details</h2><p className="muted">Adjust the location, time, manual weather, or notes for a saved run.</p>{sortedRuns.length ? <><label className="run-picker">Run<select value={selectedRun || String(sortedRuns[0].id ?? 0)} onChange={(event) => setSelectedRun(event.target.value)}>{sortedRuns.map((run, index) => <option key={run.id ?? index} value={String(run.id ?? index)}>{friendlyDate(run.date)} · {run.name} · {run.distance} km</option>)}</select></label><div className="settings-form"><label>Run location<input value={runValues.location} onChange={(event) => setRunValues({ ...runValues, location: event.target.value })}/></label><label>Start time<input type="time" value={runValues.startTime} onChange={(event) => setRunValues({ ...runValues, startTime: event.target.value })}/></label><label>Weather at start<input value={runValues.weatherStart} onChange={(event) => setRunValues({ ...runValues, weatherStart: event.target.value })}/></label><label>Weather at finish<input value={runValues.weatherEnd} onChange={(event) => setRunValues({ ...runValues, weatherEnd: event.target.value })}/></label><label className="settings-wide">Weather during the run<textarea value={runValues.weatherDuring} onChange={(event) => setRunValues({ ...runValues, weatherDuring: event.target.value })}/></label><label className="settings-wide">Notes<textarea value={runValues.notes} onChange={(event) => setRunValues({ ...runValues, notes: event.target.value })}/></label></div><button className="btn primary" onClick={() => activeRun && void onUpdateRun(activeRun, runValues)}>Save run details</button></> : <p className="empty">No runs to edit yet.</p>}</article><article className="card privacy-card"><h2>Data & privacy</h2><p>Your run log and preferences are {bundle.storage === "Turso" ? "saved in your connected Turso cloud database" : "saved in a SQLite file on this computer"}. Stride does not automatically detect your location or retrieve weather. AI review sends only the selected run details to the provider you choose; the API key is not saved.</p>{bundle.storage === "Turso" ? <p>Database: <code>Turso cloud</code></p> : <p>Database file: <code>data/stride.sqlite</code></p>}</article></div></section>;
}
