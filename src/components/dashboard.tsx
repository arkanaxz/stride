"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AnalysisReview, Bundle, Preferences, Run, Workout } from "@/lib/types";
import ThemeToggle, { applyTheme } from "@/components/theme-toggle";
import AnalysisReviewPanel from "@/components/analysis-review";
import RunHistoryTable from "@/components/run-history-table";
import RecoverMissingRuns from "@/components/recover-missing-runs";
import StrengthLogModal from "@/components/strength-log-modal";
import StrengthHistoryTable from "@/components/strength-history-table";
import BackupManager from "@/components/backup-manager";
import GarminVo2MaxTrend from "@/components/garmin-vo2max-trend";
import { groupCombinedStrengthDays } from "@/lib/combined-workout-rows";

const initialPreferences: Preferences = { defaultLocation: "Lapu-Lapu City, Cebu, Philippines", theme: "dark", raceDate: "2027-03-14", planRowCount: 1, provider: "openai", model: "gpt-6-luna", lthr: null };
const modelOptions: Record<Preferences["provider"], [string, string][]> = {
  openai: [["gpt-6-luna", "GPT-6 Luna"], ["gpt-5.6-terra", "GPT-5.6 Terra"], ["gpt-5.6-luna", "GPT-5.6 Luna"]],
  gemini: [["gemini-3.8-flash", "Gemini 3.8 Flash"], ["gemini-3.7-flash", "Gemini 3.7 Flash"], ["gemini-3.6-flash", "Gemini 3.6 Flash"], ["gemini-3.5-flash", "Gemini 3.5 Flash"], ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"], ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"], ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"], ["gemini-3-flash-preview", "Gemini 3 Flash Preview"], ["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"], ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"]],
  anthropic: [["claude-sonnet-5-5", "Claude Sonnet"], ["claude-opus-5", "Claude Opus"], ["claude-haiku-4-5", "Claude Haiku"]],
};

function isoToday() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function summaryPeriodLabel(period: "week" | "month" | "year", shift: number) { const now = new Date(isoToday() + "T12:00:00"); if (period === "week") { const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7) + shift * 7); const end = new Date(start); end.setDate(start.getDate() + 6); return friendlyDate(dateKey(start), { month: "short", day: "numeric" }) + " – " + friendlyDate(dateKey(end), { month: "short", day: "numeric", year: "numeric" }); } if (period === "month") return new Date(now.getFullYear(), now.getMonth() + shift, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); return String(now.getFullYear() + shift); }
function pace(run: Run) { if (!run.distance || !run.duration) return "—"; const seconds = Math.round(Number(run.duration) * 60 / Number(run.distance)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function canonicalShoeName(name: string) { return /^superlast\s*2$/i.test(name.trim()) ? "Superblast 2" : name.trim() || "Unspecified"; }
function friendlyDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, options) : "—"; }
function durationLabel(minutes: number) { const total = Math.round(minutes); return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`; }
function runDurationParts(minutes?: number | null): [number, number, number] { const seconds = Math.max(0, Math.round(Number(minutes || 0) * 60)); return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]; }
function runSleepParts(hours?: number | null): [number, number] { const minutes = Math.max(0, Math.round(Number(hours || 0) * 60)); return [Math.floor(minutes / 60), minutes % 60]; }
function runDetailItems(run: Run): [string, string][] { const [sleepHours, sleepMinutes] = runSleepParts(run.sleep); return [["Date", friendlyDate(run.date, { month: "long", day: "numeric", year: "numeric" })], ["Type", run.type], ["Distance", `${Number(run.distance).toFixed(2)} km`], ["Duration", durationLabel(Number(run.duration || 0))], ["Pace", `${pace(run)} /km`], ["Average HR", run.avgHr ? `${run.avgHr} bpm` : ""], ["Maximum HR", run.maxHr ? `${run.maxHr} bpm` : ""], ["Garmin VO₂ Max", run.garminVo2Max == null ? "" : `${run.garminVo2Max} mL/kg/min`], ["Sleep", run.sleep != null ? `${sleepHours} hour ${String(sleepMinutes).padStart(2, "0")} min` : ""], ["Relative effort", run.effort == null ? "" : String(run.effort)], ["RPE", run.rpe == null ? "" : String(run.rpe)], ["ITB during", run.painDuring || (run.pain == null ? "" : String(run.pain))], ["ITB next morning", run.painNext || ""], ["Location", run.location || ""], ["Start time", run.startTime || ""], ["Finish time", run.endTime || ""], ["Temperature at start", run.weatherStart || ""], ["Temperature at finish", run.weatherEnd || ""], ["Weather during", run.weatherDuring || ""], ["Imported weather note", run.weatherRoute || ""], ["Shoes", run.shoes || ""], ["Notes", run.notes || ""]]; }
function trainingDate(workout: Workout, raceDate: string) {
  const shift = raceDate === "2027-03-07" && workout.dateShiftable !== false ? -7 : 0;
  const date = new Date(`${workout.date}T12:00:00`);
  date.setDate(date.getDate() + shift);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Dashboard({ initialPage = "dashboard" }: { initialPage?: "dashboard" | "settings" }) {
  const [bundle, setBundle] = useState<Bundle>({ runs: [], plan: [], meta: {}, preferences: initialPreferences, storage: "SQLite" });
  const [page, setPage] = useState<"dashboard" | "settings">(initialPage);
  const [period, setPeriod] = useState<"week" | "month" | "year" | "all">("all");
  const [rangeShift, setRangeShift] = useState(0);
  const [chartMode, setChartMode] = useState<"week" | "month">("week");
  const [chartShift, setChartShift] = useState(0);
  const [showFullPlan, setShowFullPlan] = useState(false);
  const [workoutLimit, setWorkoutLimit] = useState(1);
  const [workoutPage, setWorkoutPage] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyPage, setHistoryPage] = useState(0);
  const [runSearch, setRunSearch] = useState("");
  const [detailRun, setDetailRun] = useState<Run | null>(null);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("");
  const [runSaveError, setRunSaveError] = useState("");
  const [runSaving, setRunSaving] = useState(false);
  const runSaveInFlight = useRef(false);
  const weatherRequest = useRef(0);
  const weatherQuery = useRef("");
  const runFormRef = useRef<HTMLFormElement | null>(null);
  const [status, setStatus] = useState("Loading your running data…");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [undoWorkout, setUndoWorkout] = useState<{ index: number; status: string } | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [livePace, setLivePace] = useState<string | null>(null);
  const [completionWorkout, setCompletionWorkout] = useState<Workout | null>(null);
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null);
  const [strengthLogWorkout, setStrengthLogWorkout] = useState<Workout | null>(null);
  const [analysisRunId, setAnalysisRunId] = useState("");
  const [analysisReviewId, setAnalysisReviewId] = useState("");
  const [commentText, setCommentText] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the database.");
        // The authenticated server database is the only source of training records.
        const loaded = await response.json() as Bundle;
        if (active) {
          const availableModels = modelOptions[loaded.preferences.provider];
          const model = availableModels.some(([id]) => id === loaded.preferences.model) ? loaded.preferences.model : availableModels[0][0];
          const storedTheme = localStorage.getItem("stride-theme");
          const theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
          setBundle({ ...loaded, preferences: { ...loaded.preferences, model, theme } });
          setWorkoutLimit(loaded.preferences.planRowCount || 1);
          setStatus("");
          setReady(true);
          document.documentElement.dataset.theme = theme;
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

  useEffect(() => {
    if (!ready || !bundle.preferences.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const next = bundle.plan.filter((workout) => workout.status !== "completed" && workout.status !== "cancelled" && trainingDate(workout, bundle.preferences.raceDate) >= isoToday()).sort((a, b) => trainingDate(a, bundle.preferences.raceDate).localeCompare(trainingDate(b, bundle.preferences.raceDate)))[0];
    if (!next) return;
    const date = trainingDate(next, bundle.preferences.raceDate);
    const reminderId = `stride-reminder:${String(next.id)}:${date}`;
    if (localStorage.getItem(reminderId)) return;
    const remindAt = new Date(`${date}T08:00:00`).getTime() - (bundle.preferences.notificationLeadHours ?? 24) * 60 * 60 * 1000;
    const delay = remindAt - Date.now();
    if (delay <= 0 || delay > 2_147_000_000) return;
    const timer = window.setTimeout(() => {
      new Notification("Stride run reminder", { body: `${next.session} · ${friendlyDate(date, { month: "short", day: "numeric" })}` });
      localStorage.setItem(reminderId, "sent");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [ready, bundle.plan, bundle.preferences.raceDate, bundle.preferences.notificationsEnabled, bundle.preferences.notificationLeadHours]);

  async function persist(next: Bundle, message = `Saved to ${next.storage === "Turso" ? "Turso" : "local SQLite"}`): Promise<Bundle | null> {
    // Preference changes must not rewrite the workout plan or historical runs.
    const changes: Partial<Bundle> & { baseRuns?: Run[]; basePlan?: Workout[] } = {};
    if (JSON.stringify(next.runs) !== JSON.stringify(bundle.runs)) { changes.runs = next.runs; changes.baseRuns = bundle.runs; }
    if (JSON.stringify(next.plan) !== JSON.stringify(bundle.plan)) { changes.plan = next.plan; changes.basePlan = bundle.plan; }
    if (JSON.stringify(next.preferences) !== JSON.stringify(bundle.preferences)) changes.preferences = next.preferences;
    if (JSON.stringify(next.meta) !== JSON.stringify(bundle.meta)) changes.meta = next.meta;
    if (!Object.keys(changes).length) return next;
    setBundle(next);
    try {
      const response = await fetch("/api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error || "Could not save changes to the database."); }
      const saved = await response.json() as Bundle;
      setBundle(saved);
      setToast(message);
      return saved;
    } catch (reason) {
      setBundle(bundle);
      setError(reason instanceof Error ? reason.message : "Could not save changes.");
      return null;
    }
  }

  const visibleRuns = useMemo(() => {
    const today = isoToday();
    if (period === "all") return bundle.runs.filter((run) => run.date <= today);
    const now = new Date(today + "T12:00:00");
    let start: Date; let end: Date;
    if (period === "week") { start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7) + rangeShift * 7); end = new Date(start); end.setDate(start.getDate() + 7); }
    else if (period === "month") { start = new Date(now.getFullYear(), now.getMonth() + rangeShift, 1); end = new Date(start.getFullYear(), start.getMonth() + 1, 1); }
    else { start = new Date(now.getFullYear() + rangeShift, 0, 1); end = new Date(start.getFullYear() + 1, 0, 1); }
    const startKey = dateKey(start); const endKey = dateKey(end);
    return bundle.runs.filter((run) => run.date >= startKey && run.date < endKey && run.date <= today);
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
  const shoeMileage = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const [name, value] of Object.entries(bundle.shoeMileageBase || {})) {
      const canonical = canonicalShoeName(name);
      grouped.set(canonical, (grouped.get(canonical) || 0) + Number(value || 0));
    }
    for (const run of bundle.runs) {
      const canonical = canonicalShoeName(run.shoes || "Unspecified");
      grouped.set(canonical, (grouped.get(canonical) || 0) + Number(run.distance || 0));
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [bundle.runs, bundle.shoeMileageBase]);
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

  function updateLivePace(form: HTMLFormElement | null) {
    if (!form) return;
    const fields = new FormData(form);
    const distance = Number(fields.get("distance"));
    const duration = Number(fields.get("durationHours")) * 60 + Number(fields.get("durationMinutes")) + Number(fields.get("durationSeconds")) / 60;
    setLivePace(distance > 0 && duration > 0 ? pace({ distance, duration } as Run) : "—");
  }

  async function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const run: Run = { date: String(form.get("date")), name: String(form.get("name")), type: String(form.get("type")), distance: Number(form.get("distance")), duration: Number(form.get("durationHours")) * 60 + Number(form.get("durationMinutes")) + Number(form.get("durationSeconds")) / 60, avgHr: Number(form.get("avgHr")) || null, maxHr: Number(form.get("maxHr")) || null, sleep: Number(form.get("sleepHours")) + Number(form.get("sleepMinutes")) / 60 || null, painDuring: String(form.get("painDuring")), painNext: String(form.get("painNext")), pain: Number(form.get("pain")) || 0, effort: Number(form.get("effort")) || null, rpe: form.get("rpe") ? Number(form.get("rpe")) : null, garminVo2Max: form.get("garminVo2Max") ? Number(form.get("garminVo2Max")) : null, shoes: String(form.get("shoes")), location: String(form.get("location")), startTime: String(form.get("startTime")), endTime: String(form.get("endTime")), weatherStart: String(form.get("weatherStart")), weatherEnd: String(form.get("weatherEnd")), weatherDuring: String(form.get("weatherDuring")), notes: String(form.get("notes")) };
    if (run.duration <= 0) { setError("Enter a duration greater than zero."); return; }
    if (editingRun) {
      const editIndex = bundle.runs.indexOf(editingRun);
      if (editIndex < 0) { setError("That run is no longer in your history. Refresh and try again."); return; }
      const saved = await persist({ ...bundle, runs: bundle.runs.map((item, index) => index === editIndex ? { ...editingRun, ...run, id: editingRun.id, analysis: editingRun.analysis, analysisHistory: editingRun.analysisHistory } : item) }, "Run updated");
      if (saved) { formElement.reset(); setRunDialog(false); setEditingRun(null); setWeatherStatus(""); }
      return;
    }
    if (completionWorkout) {
      // Run History and the planned workout status are committed atomically.
      if (runSaveInFlight.current) return;
      runSaveInFlight.current = true;
      setRunSaving(true);
      setRunSaveError("");
      try {
        const response = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "complete-workout", workoutId: completionWorkout.id, run }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not save the run and complete the workout.");
        const saved = result as Bundle & { loggedRunId?: number; insertedRun?: boolean };
        if (saved.plan.find(item => String(item.id) === String(completionWorkout.id))?.status !== "completed") {
          throw new Error("The workout was not confirmed Completed. Refresh Stride.");
        }
        setBundle(saved);
        setUndoWorkout(null);
        setToast("Run logged · workout completed · progress updated");
        formElement.reset(); setRunDialog(false); setCompletionWorkout(null);
        if (saved.insertedRun && saved.loggedRunId) void analyzeSavedRun(saved.loggedRunId);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Could not complete workout.";
        // Keep errors inside the modal so the user sees why Save failed.
        setRunSaveError(message);
        setError(message);
      } finally {
        runSaveInFlight.current = false;
        setRunSaving(false);
      }
      return;
    }
    const saved = await persist({ ...bundle, runs: [...bundle.runs, run] }, "Run saved to your database");
    if (saved) {
      formElement.reset(); setRunDialog(false); setCompletionWorkout(null);
      const savedRun = saved.runs.find(item => item.date === run.date && item.name === run.name);
      if (savedRun?.id) void analyzeSavedRun(savedRun.id);
    }
  }

  async function fillWeather(form: HTMLFormElement | null, onlyMissing = false) {
    if (!form) return;
    const data = new FormData(form);
    const location = String(data.get("location") || "").trim();
    const date = String(data.get("date") || "");
    const startTime = String(data.get("startTime") || "");
    const endTime = String(data.get("endTime") || "");
    if (!location || !date || !startTime) return;
    const queryKey = [location, date, startTime, endTime].join("|");
    if (queryKey === weatherQuery.current) return;
    weatherQuery.current = queryKey;
    const requestId = ++weatherRequest.current;
    setWeatherStatus("Finding hourly temperatures…");
    try {
      const response = await fetch("/api/weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, date, startTime, endTime }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Weather lookup failed.");
      if (requestId !== weatherRequest.current) return;
      const weatherStart = form.elements.namedItem("weatherStart") as HTMLInputElement | null;
      const weatherEnd = form.elements.namedItem("weatherEnd") as HTMLInputElement | null;
      if (weatherStart && (!onlyMissing || !weatherStart.value.trim())) weatherStart.value = result.weatherStart;
      if (weatherEnd && result.weatherEnd && (!onlyMissing || !weatherEnd.value.trim())) weatherEnd.value = result.weatherEnd;
      setWeatherStatus(endTime
        ? `Estimated hourly temperatures added from Open-Meteo (${result.location}).`
        : `Start temperature added for ${result.location}. Enter run duration to calculate the finish temperature.`);
    } catch (reason) { if (requestId === weatherRequest.current) { weatherQuery.current = ""; setWeatherStatus(reason instanceof Error ? reason.message : "Weather lookup failed."); } }
  }

  function updateFinishTime(form: HTMLFormElement | null) {
    if (!form) return;
    const data = new FormData(form);
    const startTime = String(data.get("startTime") || "");
    const finishInput = form.elements.namedItem("endTime") as HTMLInputElement | null;
    if (!finishInput) return;
    const durationSeconds = Number(data.get("durationHours")) * 3600 + Number(data.get("durationMinutes")) * 60 + Number(data.get("durationSeconds"));
    if (!startTime || durationSeconds <= 0) { finishInput.value = ""; return; }
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const finishTotalMinutes = (startHour * 60 + startMinute + Math.round(durationSeconds / 60)) % (24 * 60);
    finishInput.value = `${String(Math.floor(finishTotalMinutes / 60)).padStart(2, "0")}:${String(finishTotalMinutes % 60).padStart(2, "0")}`;
  }


  useEffect(() => {
    if (!runDialog || !runFormRef.current) return;
    const form = runFormRef.current;
    const startTime = (form.elements.namedItem("startTime") as HTMLInputElement | null)?.value;
    const endInput = form.elements.namedItem("endTime") as HTMLInputElement | null;
    const startWeather = (form.elements.namedItem("weatherStart") as HTMLInputElement | null)?.value.trim();
    const endWeather = (form.elements.namedItem("weatherEnd") as HTMLInputElement | null)?.value.trim();
    if (!startTime || (startWeather && endWeather)) return;
    if (endInput && !endInput.value) updateFinishTime(form);
    // Respect manually entered or previously saved temperatures when reopening a run.
    void fillWeather(form, true);
  }, [runDialog, editingRun?.id, completionWorkout?.id]);

  async function deleteRun(run: Run) {
    if (!window.confirm(`Delete “${run.name}” from ${friendlyDate(run.date)}? This cannot be undone.`)) return;
    const index = bundle.runs.indexOf(run);
    if (index < 0) return;
    const saved = await persist({ ...bundle, runs: bundle.runs.filter((_, itemIndex) => itemIndex !== index) }, "Run deleted");
    if (saved) setDetailRun(null);
  }

  async function postRunComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailRun?.id || !commentText.trim()) return;
    const response = await fetch("/api/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: detailRun.id, text: commentText }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "Could not add comment."); return; }
    setBundle((current) => ({ ...current, comments: result }));
    setCommentText("");
  }

  async function removeRunComment(id: number) {
    const response = await fetch("/api/comments", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) { setError("Could not remove comment."); return; }
    setBundle((current) => ({ ...current, comments: (current.comments || []).filter((comment) => comment.id !== id) }));
  }

  async function addWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const workout: Workout = { id: crypto.randomUUID(), date: String(form.get("date")), week: Number(form.get("week")) || 0, phase: String(form.get("phase")), session: String(form.get("session")), target: String(form.get("target")), pace: String(form.get("pace")), hr: String(form.get("hr")), status: "planned" };
    await persist({ ...bundle, plan: [...bundle.plan, workout].sort((a, b) => a.date.localeCompare(b.date)) }, "Workout added to your training block");
    formElement.reset();
  }

  async function saveWorkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingWorkout) return;
    const values = new FormData(event.currentTarget);
    const updated = { ...editingWorkout, date: String(values.get("date")), week: Number(values.get("week")) || 0, phase: String(values.get("phase")), session: String(values.get("session")), target: String(values.get("target")), pace: String(values.get("pace")), hr: String(values.get("hr")), notes: String(values.get("notes")) };
    const saved = await persist({ ...bundle, plan: bundle.plan.map((workout) => workout.id === editingWorkout.id ? updated : workout).sort((a, b) => a.date.localeCompare(b.date)) }, "Planned workout updated");
    if (saved) setEditingWorkout(null);
  }

  async function updateWorkout(workout: Workout, status: string) {
    const index = bundle.plan.indexOf(workout);
    if (index < 0) return;
    const previousStatus = workout.status || "planned";
    const saved = await persist({ ...bundle, plan: bundle.plan.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item) }, status === "completed" ? "Workout marked done" : status === "cancelled" ? "Workout cancelled but retained in plan" : "Workout restored");
    if (saved && (status === "completed" || status === "cancelled")) setUndoWorkout({ index, status: previousStatus });
  }

  async function deletePlannedWorkout(workout: Workout) {
    if (workout.status === "completed") { setError("Completed workouts cannot be deleted here."); return; }
    if (!window.confirm(`Permanently delete “${workout.session}” (${workout.date})? Choose Cancel instead if you want to keep a record of the skipped session.`)) return;
    const saved = await persist({ ...bundle, plan: bundle.plan.filter((item) => item !== workout) }, "Planned workout deleted");
    if (saved) setEditingWorkout(null);
  }

  async function importFile(file?: File) {
    if (!file) return;
    setUploading(true); setError("");
    try {
      // Preview and explicitly confirm the import before touching Turso.
      // Completed workouts and all logged runs remain in the database.
      const previewForm = new FormData(); previewForm.set("file", file); previewForm.set("preview", "true");
      const previewResponse = await fetch("/api/import", { method: "POST", body: previewForm });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error || "Could not preview the workbook.");
      const question = `Import ${preview.importedRuns} new running-log entries from ${file.name}?\n\nExisting ${preview.preservedRuns} running logs will be preserved. Your entire Training Block, completed workouts, and preferences will remain unchanged.\n\nContinue?`;
      if (!window.confirm(question)) return;
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setBundle({ ...result, user: bundle.user, comments: bundle.comments, shoeMileageBase: bundle.shoeMileageBase });
      setToast(`Imported ${result.importedRuns} running logs; training plan unchanged`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); }
    finally { setUploading(false); }
  }

  function exportCsv() {
    const keys: (keyof Run)[] = ["date", "name", "type", "distance", "duration", "avgHr", "maxHr", "sleep", "rpe", "garminVo2Max", "painDuring", "painNext", "effort", "weatherStart", "weatherEnd", "weatherDuring", "location", "startTime", "endTime", "shoes", "notes"];
    const quote = (value: unknown) => { const item = String(value ?? ""); return /[",\n\r]/.test(item) ? `"${item.replaceAll('"', '""')}"` : item; };
    const csv = [keys.join(","), ...bundle.runs.map((run) => keys.map((key) => quote(run[key])).join(","))].join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "stride-runs.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  async function analyzeSavedRun(runId: number) {
    setAnalyzing(true); setAnalysis("Sending run details to your selected provider…"); setError("");
    setAnalysisRunId(String(runId));
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Analysis request failed.");
      setAnalysis(result.answer || "No response text was returned.");
      setAnalysisReviewId((result.review as AnalysisReview | undefined)?.id || "");
      setBundle((current) => ({ ...current, runs: current.runs.map((run) => run.id === runId ? { ...run, analysis: result.answer, analysisHistory: Array.isArray(result.history) ? result.history as AnalysisReview[] : result.review ? [...(run.analysisHistory || []), result.review as AnalysisReview] : run.analysisHistory } : run) }));
    } catch (reason) { setAnalysis(""); setError(reason instanceof Error ? reason.message : "Analysis failed."); }
    finally { setAnalyzing(false); }
  }

  async function analyzeRun() {
    const run = bundle.runs.find((item) => String(item.id ?? item.date + item.name) === analysisRunId) || bundle.runs[0];
    if (!run?.id) { setError("Log or import a saved run before requesting analysis."); return; }
    await analyzeSavedRun(run.id);
  }

  async function savePreferences(next: Preferences) {
    applyTheme(next.theme);
    localStorage.setItem("stride-default-location", next.defaultLocation);
    localStorage.setItem("stride-race-date", next.raceDate);
    localStorage.setItem("stride-plan-row-count", String(next.planRowCount));
    localStorage.setItem("stride-theme", next.theme);
    await persist({ ...bundle, preferences: next }, "Settings saved");
  }

  async function renameShoes(names: Record<string, string>) {
    const updated = bundle.runs.map((run) => {
      const oldName = run.shoes || "Unspecified";
      const newName = names[oldName]?.trim();
      return newName && newName !== oldName ? { ...run, shoes: newName } : run;
    });
    const mileageBase: Record<string, number> = {};
    for (const [name, value] of Object.entries(bundle.shoeMileageBase || {})) {
      const updatedName = names[name]?.trim() || name;
      mileageBase[updatedName] = (mileageBase[updatedName] || 0) + Number(value || 0);
    }
    const saved = await persist({ ...bundle, runs: updated }, "Shoe names saved");
    if (saved) {
      await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-mileage", mileage: mileageBase }) });
      setBundle((current) => ({ ...current, shoeMileageBase: mileageBase }));
    }
  }

  async function updateRun(run: Run, updates: Partial<Run>) {
    const target = run.id ?? `${run.date}|${run.name}`;
    await persist({ ...bundle, runs: bundle.runs.map((item) => (item.id ?? `${item.date}|${item.name}`) === target ? { ...item, ...updates } : item) }, "Run details saved");
  }

  if (!ready) return <main className="loading"><div className="brand-mark">↗</div><h1>Stride</h1><p>{status}</p>{error && <p className="error">{error}</p>}</main>;

  const activePlan = bundle.plan.filter((workout) => workout.status !== "superseded");
  const isSub20CurrentPlan = (bundle.meta.title || "").startsWith("Sub-20 5K");
  const upcoming = activePlan.filter((workout) => workout.status !== "completed" && workout.status !== "cancelled" && trainingDate(workout, bundle.preferences.raceDate) >= isoToday()).sort((a, b) => trainingDate(a, bundle.preferences.raceDate).localeCompare(trainingDate(b, bundle.preferences.raceDate)));
  const strengthHistory = bundle.plan.filter(workout => Boolean(workout.strength) && (workout.status === "completed" || workout.strengthLog)).sort((a, b) => (b.strengthLog?.date || b.date).localeCompare(a.strengthLog?.date || a.date));
  const allHistoryRuns = [...bundle.runs].sort((a, b) => b.date.localeCompare(a.date));
  const matchingHistoryRuns = allHistoryRuns.filter((run) => !runSearch.trim() || Object.values(run).some((value) => String(value ?? "").toLowerCase().includes(runSearch.trim().toLowerCase())));
  const historyPageCount = Math.max(1, Math.ceil(matchingHistoryRuns.length / historyLimit));
  const historyRows = matchingHistoryRuns.slice(historyPage * historyLimit, (historyPage + 1) * historyLimit);
  const runsForAnalysis = [...bundle.runs].sort((a, b) => b.date.localeCompare(a.date));
  const selectedAnalysisRun = runsForAnalysis.find((run) => String(run.id ?? run.date + run.name) === analysisRunId) || runsForAnalysis[0];
  const reviewHistory = [...(selectedAnalysisRun?.analysisHistory || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedReview = reviewHistory.find((review) => review.id === analysisReviewId) || reviewHistory[0];
  const visibleAnalysis = analysis || selectedReview?.text || selectedAnalysisRun?.analysis || "";
  const fullReviewHref = selectedAnalysisRun?.id ? `/reviews/${selectedAnalysisRun.id}${selectedReview ? `?reviewId=${encodeURIComponent(selectedReview.id)}` : ""}` : "";
  // Collapse an imported Wednesday run + Strength A into one row while
  // retaining both underlying records for separate mileage and strength logs.
  const combinedPlanRows = groupCombinedStrengthDays(activePlan);
  const isUpcomingWorkout = (workout: Workout) => workout.status !== "completed" &&
    workout.status !== "cancelled" && trainingDate(workout, bundle.preferences.raceDate) >= isoToday();
  const orderedWorkoutRows = (showFullPlan ? combinedPlanRows : combinedPlanRows.filter(({ workout, linkedRun }) =>
    isUpcomingWorkout(workout) || (linkedRun !== null && isUpcomingWorkout(linkedRun))
  )).sort((a, b) => trainingDate(a.workout, bundle.preferences.raceDate).localeCompare(trainingDate(b.workout, bundle.preferences.raceDate)));
  const workoutPageSize = Math.max(1, workoutLimit);
  const workoutPageCount = Math.max(1, Math.ceil(orderedWorkoutRows.length / workoutPageSize));
  const activeWorkoutPage = Math.min(workoutPage, workoutPageCount - 1);
  const workoutPageStart = activeWorkoutPage * workoutPageSize;
  const selectedWorkoutRows = orderedWorkoutRows.slice(workoutPageStart, workoutPageStart + workoutPageSize);
  const periodLabel = period === "all" ? "Past runs · All time" : summaryPeriodLabel(period, rangeShift);
  // The displayed series already contains the full selected week or all in-month weeks.
  // Sum those exact plotted distances so the headline always matches the chart.
  const chartMileage = chart.reduce((sum, point) => sum + point.distance, 0);
  const startPoint = chart[0], endPoint = chart[chart.length - 1];
  const chartMonth = new Date(); chartMonth.setDate(1); chartMonth.setMonth(chartMonth.getMonth() + chartShift);
  const chartLabel = chartMode === "week" ? `${friendlyDate(startPoint.dateKey)} – ${friendlyDate(new Date(`${endPoint.dateKey}T12:00:00`).toISOString().slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}` : chartMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const line = chart.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${chart[0].x},190 ${line} ${chart[chart.length - 1].x},190`;
  const cancelledCount = activePlan.filter((workout) => workout.status === "cancelled").length;
  const plannedCount = activePlan.length - cancelledCount;
  const completedCount = activePlan.filter((workout) => workout.status === "completed").length;

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">↗</span><span>stride<span className="lime">.</span></span></a><nav className="main-nav"><a className={page === "dashboard" ? "nav-link active" : "nav-link"} href="/">Dashboard</a><a className="nav-link" href="/history">Run History</a>{bundle.user?.role === "admin" && <a className={page === "settings" ? "nav-link active" : "nav-link"} href="/settings">Settings</a>}</nav><div className="top-actions"><ThemeToggle onChange={(theme) => { if (bundle.user?.role === "admin") void savePreferences({ ...bundle.preferences, theme }); else setBundle((current) => ({ ...current, preferences: { ...current.preferences, theme } })); }}/><span className="user-badge">{bundle.user?.username} · {bundle.user?.role === "admin" ? "Admin" : "Viewer"}</span>{bundle.user?.role === "admin" && <><label className="btn upload-btn">{uploading ? "Importing…" : "Import Run Log"}<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} hidden /></label><button className="btn" onClick={exportCsv}>Export CSV</button><button className="btn primary" onClick={() => { setEditingRun(null); setCompletionWorkout(null); setWeatherStatus(""); weatherQuery.current = ""; setRunDialog(true); }}>＋ Log a run</button></>}</div></header>
    {error && <div className="notice error">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
    {page === "dashboard" ? <>
      <section className="hero"><div><div className="eyebrow">YOUR TRAINING, IN STRIDE</div><h1>Run dashboard</h1><div className="muted">A clear view of your training, recovery, and progress.</div></div><div className="hero-right summary-range"><select aria-label="Summary period" value={period} onChange={(event) => { setPeriod(event.target.value as typeof period); setRangeShift(0); }}><option value="all">All past runs</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="year">Yearly</option></select>{period !== "all" && <><button className="btn" aria-label="Previous summary period" onClick={() => setRangeShift((value) => value - 1)}>‹</button><span>{periodLabel}</span><button className="btn" aria-label="Next summary period" disabled={rangeShift >= 0} onClick={() => setRangeShift((value) => Math.min(0, value + 1))}>›</button></>}</div></section>{upcoming[0] && <section className="card upcoming-reminder"><strong>Next planned run</strong><span>{friendlyDate(trainingDate(upcoming[0], bundle.preferences.raceDate), { weekday: "long", month: "long", day: "numeric" })} · {upcoming[0].session.split(":")[0]} · {upcoming[0].target?.split(" · ")[0] || "See workout details below"}. Full workout details are in the Training Block.</span></section>}
      <section className="card training-card"><div className="card-head"><div><div className="eyebrow">TRAINING BLOCK</div><h2>{bundle.meta.title || "SM2SM 2027 Half Marathon"}</h2><div className="muted">{plannedCount} active sessions · {completedCount} completed · {cancelledCount} cancelled · {isSub20CurrentPlan ? "5K goal: sub-20" : `Goal ${bundle.meta.goalFinish || "1:44:59"}`}</div></div>{bundle.user?.role === "admin" && <div className="plan-actions">{isSub20CurrentPlan ? <div className="compact-field">Workbook race dates<strong>Mar 7 HM · Jun 26 5K</strong></div> : <label className="compact-field">Race date<select value={bundle.preferences.raceDate} onChange={(event) => void savePreferences({ ...bundle.preferences, raceDate: event.target.value })}><option value="2027-03-14">Mar 14, 2027</option><option value="2027-03-07">Mar 7, 2027</option></select></label>}<label className="compact-field">Show<select value={workoutLimit} onChange={(event) => { setWorkoutLimit(Number(event.target.value)); setWorkoutPage(0); void savePreferences({ ...bundle.preferences, planRowCount: Number(event.target.value) }); }}>{[1, 5, 10, 20, 50, 100].map((count) => <option key={count}>{count}</option>)}</select></label><button className="btn" onClick={() => { setShowFullPlan(!showFullPlan); setWorkoutPage(0); }}>{showFullPlan ? "Upcoming only" : "Include past & completed"}</button></div>}</div><div className="progress-row"><div className="track"><div className="fill" style={{ width: `${plannedCount ? completedCount / plannedCount * 100 : 0}%` }} /></div><span>{plannedCount ? Math.round(completedCount / plannedCount * 100) : 0}%</span></div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Week / phase</th><th>Planned workout</th><th>Target</th><th>Status</th></tr></thead><tbody>{selectedWorkoutRows.length ? selectedWorkoutRows.map(({ workout, linkedRun }, index) => <tr key={workout.id ?? `${workout.date}|${workout.session}|${index}`}><td>{friendlyDate(trainingDate(workout, bundle.preferences.raceDate), { month: "short", day: "numeric", weekday: "short" })}</td><td>{workout.phase || `Week ${workout.week}`}</td><td><strong>{workout.session}</strong>{workout.strength && <span className="table-sub">{linkedRun ? "Easy run + Strength A · log each activity separately" : "Strength / mobility"}</span>}</td><td>{workout.target || workout.pace || "As written"}{workout.strength && <details className="strength-prescription"><summary>View exercise prescription</summary><div>{workout.strength}</div></details>}</td><td>{linkedRun ? (bundle.user?.role === "admin" ? <>
  <div className="combined-workout-actions">
    <div className="combined-workout-part"><small>Easy run</small>
      {linkedRun.status === "cancelled"
        ? <button type="button" className="status cancelled" onClick={() => void updateWorkout(linkedRun, "planned")}>Run cancelled · restore</button>
        : <button type="button" className={linkedRun.status === "completed" ? "status done" : "status"} onClick={() => {
            if (linkedRun.status === "completed") void updateWorkout(linkedRun, "planned");
            else { setEditingRun(null); setCompletionWorkout(linkedRun); setWeatherStatus(""); weatherQuery.current = ""; setRunDialog(true); }
          }}>{linkedRun.status === "completed" ? "Run completed · undo" : "Log run"}</button>}
    </div>
    <div className="combined-workout-part"><small>Strength A</small>
      {workout.status === "cancelled"
        ? <button type="button" className="status cancelled" onClick={() => void updateWorkout(workout, "planned")}>Strength cancelled · restore</button>
        : <button type="button" className={workout.status === "completed" ? "status done" : "status"} onClick={() => {
            if (workout.status === "completed") void updateWorkout(workout, "planned");
            else { setStrengthLogWorkout(workout); setError(""); }
          }}>{workout.status === "completed" ? "Strength completed · undo" : "Log strength"}</button>}
    </div>
  </div>
  {workout.status === "completed" && <button type="button" className="btn" onClick={() => { setStrengthLogWorkout(workout); setError(""); }}>{workout.strengthLog ? "Edit strength log" : "Add strength details"}</button>}
  <details className="combined-workout-manage"><summary>Manage run / strength plans</summary><div>
    <button type="button" className="btn" onClick={() => setEditingWorkout(linkedRun)}>Edit run plan</button>
    <button type="button" className="btn" onClick={() => setEditingWorkout(workout)}>Edit strength plan</button>
    {linkedRun.status !== "completed" && <>
      <button type="button" className="btn" onClick={() => void updateWorkout(linkedRun, linkedRun.status === "cancelled" ? "planned" : "cancelled")}>{linkedRun.status === "cancelled" ? "Restore run" : "Cancel run"}</button>
      <button type="button" className="btn danger" onClick={() => void deletePlannedWorkout(linkedRun)}>Delete run</button>
    </>}
    {workout.status !== "completed" && <>
      <button type="button" className="btn" onClick={() => void updateWorkout(workout, workout.status === "cancelled" ? "planned" : "cancelled")}>{workout.status === "cancelled" ? "Restore strength" : "Cancel strength"}</button>
      <button type="button" className="btn danger" onClick={() => void deletePlannedWorkout(workout)}>Delete strength</button>
    </>}
  </div></details>
</> : <span className="muted">Run: {linkedRun.status || "planned"} · Strength: {workout.status || "planned"}</span>) : <>{bundle.user?.role === "admin" ? <>{workout.status === "cancelled" ? <button type="button" className="status cancelled" onClick={() => void updateWorkout(workout, "planned")}>Cancelled · restore</button> : <button className={workout.status === "completed" ? "status done" : "status"} onClick={() => { if (workout.status === "completed") void updateWorkout(workout, "planned"); else if (workout.strength) { setStrengthLogWorkout(workout); setError(""); } else { setEditingRun(null); setCompletionWorkout(workout); setWeatherStatus(""); weatherQuery.current = ""; setRunDialog(true); } }}>{workout.status === "completed" ? "Completed · undo" : "Log as done"}</button>}{workout.strength && workout.status === "completed" && <button type="button" className="btn" onClick={() => { setStrengthLogWorkout(workout); setError(""); }}>{workout.strengthLog ? "Edit strength log" : "Add strength details"}</button>}<button type="button" className="btn" onClick={() => setEditingWorkout(workout)}>Edit plan</button>{workout.status !== "completed" && <><button type="button" className="btn" onClick={() => void updateWorkout(workout, workout.status === "cancelled" ? "planned" : "cancelled")}>{workout.status === "cancelled" ? "Restore" : "Cancel"}</button><button type="button" className="btn danger" onClick={() => void deletePlannedWorkout(workout)}>Delete</button></>}</> : <span className={workout.status === "completed" ? "status done" : workout.status === "cancelled" ? "status cancelled" : "status"}>{workout.status === "completed" ? "Completed" : workout.status === "cancelled" ? "Cancelled" : "Planned"}</span>}</>}</td></tr>) : <tr><td colSpan={5} className="empty">No scheduled workouts in this view. Add a workout below or switch to Include past & completed.</td></tr>}</tbody></table></div><nav className="plan-pagination" aria-label="Training Block pages"><span>Showing {orderedWorkoutRows.length ? workoutPageStart + 1 : 0}–{Math.min(workoutPageStart + workoutPageSize, orderedWorkoutRows.length)} of {orderedWorkoutRows.length} workouts · Page {activeWorkoutPage + 1} of {workoutPageCount}</span><div><button type="button" className="btn" disabled={activeWorkoutPage === 0} onClick={() => setWorkoutPage(Math.max(0, activeWorkoutPage - 1))}>← Previous</button><button type="button" className="btn" disabled={activeWorkoutPage >= workoutPageCount - 1} onClick={() => setWorkoutPage(Math.min(workoutPageCount - 1, activeWorkoutPage + 1))}>Next →</button></div></nav>{bundle.user?.role === "admin" && <details className="add-workout"><summary>＋ Add a workout to this training block</summary><form className="workout-form" onSubmit={(event) => void addWorkout(event)}><input name="date" type="date" required defaultValue={isoToday()} /><input name="week" type="number" min="0" placeholder="Week"/><input name="phase" placeholder="Training phase"/><input name="session" placeholder="Workout description" required/><input name="target" placeholder="Target duration / distance"/><input name="pace" placeholder="Pace target"/><input name="hr" placeholder="Heart-rate guidance"/><button className="btn primary">Add workout</button></form></details>}</section>
            <section className="stats-grid">{[["Distance", `${totals.distance.toFixed(1)} km`, `${visibleRuns.length} runs · ${periodLabel}`],["Duration", durationLabel(totals.duration), "Total running time"],["Average heart rate", totals.averageHr ? `${totals.averageHr} bpm` : "—", `Maximum ${totals.maxHr || "—"} bpm`],["Average pace", totals.averagePace === "—" ? "—" : `${totals.averagePace} /km`, "Distance-weighted"]].map(([label, value, note]) => <article className="card stat" key={label}><div className="muted">{label}</div><strong>{value}</strong><small>{note}</small></article>)}</section>
      <section className="two-columns"><article className="card"><div className="card-head"><div><h2>Distance over time</h2><p className="muted">{chartMode === "week" ? "Full Monday–Sunday weeks" : "Weekly totals for the selected month"} · Hover for pace and HR.</p></div><div className="chart-nav"><select aria-label="Chart period" value={chartMode} onChange={(event) => { setChartMode(event.target.value as "week" | "month"); setChartShift(0); }}><option value="week">Weekly</option><option value="month">Monthly</option></select><button className="btn" aria-label={chartMode === "week" ? "Previous week" : "Previous month"} onClick={() => setChartShift((value) => value - 1)}>‹</button><span>{chartLabel}</span><button className="btn" aria-label={chartMode === "week" ? "Next week" : "Next month"} onClick={() => setChartShift((value) => value + 1)}>›</button></div></div><div className="chart-mileage" aria-live="polite"><span>{chartMode === "week" ? (chartShift === 0 ? "This week" : "Selected week") : (chartShift === 0 ? "This month" : "Selected month")}</span><strong>{chartMileage.toFixed(2)} <small>km</small></strong></div><div className="chart"><svg viewBox="0 0 640 220" role="img" aria-label="Running distance chart"><line className="gridline" x1="38" y1="40" x2="640" y2="40"/><line className="gridline" x1="38" y1="110" x2="640" y2="110"/><line className="gridline" x1="38" y1="190" x2="640" y2="190"/><polygon points={area} className="chart-area"/><polyline points={line} className="chart-line"/>{chart.map((point) => <g className="chart-point" key={point.dateKey}><circle cx={point.x} cy={point.y} r="6"/><text x={point.x} y="213" textAnchor="middle">{point.label}</text><title>{`${point.label}: ${point.distance.toFixed(2)} km · ${point.pace} min/km · ${point.hr ? `${point.hr} bpm` : "No HR"}`}</title><foreignObject x={point.x - 42} y={point.y - 72} width="150" height="64"><div className="chart-tooltip"><b>{point.label}</b><span>{point.distance.toFixed(2)} km</span><span>Avg pace: {point.pace}</span><span>Avg HR: {point.hr ? `${point.hr} bpm` : "—"}</span></div></foreignObject></g>)}</svg></div></article><article className="card"><h2>Run Review</h2><p className="muted">Honest feedback from your chosen AI provider.</p><div className="review-controls"><label>Run<select value={analysisRunId || String(runsForAnalysis[0]?.id ?? "")} onChange={(event) => { const id = event.target.value; const run = bundle.runs.find((item) => String(item.id ?? item.date + item.name) === id); setAnalysisRunId(id); setAnalysisReviewId(run?.analysisHistory?.at(-1)?.id || ""); setAnalysis(""); }}>{runsForAnalysis.map((run, index) => <option key={run.id ?? `${run.date}-${index}`} value={String(run.id ?? run.date + run.name)}>{friendlyDate(run.date)} · {run.name} · {run.distance} km</option>)}</select></label>{reviewHistory.length > 0 && <label>Saved response<select value={selectedReview?.id || ""} onChange={(event) => { setAnalysisReviewId(event.target.value); setAnalysis(""); }}>{reviewHistory.map((review, index) => <option key={review.id} value={review.id}>{new Date(review.createdAt).toLocaleString()} · {review.model || review.provider} · #{reviewHistory.length - index}</option>)}</select></label>}</div><p className="consent">Run details and heart-rate zones are sent to the selected AI provider. The saved provider key is encrypted on the Stride server.</p>{bundle.user?.role === "admin" && <button className="btn primary" disabled={analyzing || !bundle.runs.length} onClick={() => void analyzeRun()}>{analyzing ? "Analyzing…" : "Analyze this run"}</button>}{visibleAnalysis && <><AnalysisReviewPanel key={`${selectedAnalysisRun?.id ?? "none"}:${analysisReviewId || selectedReview?.id || "latest"}`} text={visibleAnalysis} defaultExpanded={Boolean(analysis)}/>{fullReviewHref && <a className="btn review-open" href={fullReviewHref} target="_blank" rel="noreferrer">Open full review in new tab ↗</a>}</>}</article></section>
      <GarminVo2MaxTrend runs={bundle.runs}/>
      <section className="two-columns"><article className="card"><div className="card-head"><div><h2><a className="section-tab-link" href="/history">Run history</a></h2><p className="muted">All logged sessions, newest first</p></div><div className="history-controls"><input className="run-search" type="search" aria-label="Search run history" placeholder="Search runs" value={runSearch} onChange={(event) => { setRunSearch(event.target.value); setHistoryPage(0); }}/><label className="compact-field">Show<select value={historyLimit} onChange={(event) => { setHistoryLimit(Number(event.target.value)); setHistoryPage(0); }}>{[1, 5, 10, 50, 100].map((count) => <option key={count}>{count}</option>)}</select></label><button className="btn" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}>Previous</button><span>{historyPage + 1} / {historyPageCount}</span><button className="btn" disabled={historyPage + 1 >= historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))}>Next</button></div></div><RunHistoryTable runs={historyRows} onOpen={setDetailRun}/>{!allHistoryRuns.length ? <p className="empty">No runs yet. Add a run or import your workbook.</p> : !matchingHistoryRuns.length ? <p className="empty">No runs match “{runSearch}”.</p> : null}</article><article className="card"><h2>Shoe mileage</h2><p className="muted">Mileage based on your complete run log</p>{shoeMileage.map(([shoe, mileage]) => <div className="shoe-row" key={shoe}><span className="shoe-icon">👟</span><strong>{shoe}</strong><span>{mileage.toFixed(1)} km</span></div>)}{!shoeMileage.length && <p className="empty">Mileage appears after your first run.</p>}</article></section>
      <section className="card strength-history-card" aria-label="Strength workout history">
        <div className="card-head"><div><h2>Strength workout history</h2>
          <p className="muted">Completed strength sessions, newest first · Separate from running mileage and shoe tracking.</p>
        </div></div>
        <StrengthHistoryTable workouts={strengthHistory} isAdmin={bundle.user?.role === "admin"}
          onOpen={(workout) => { setStrengthLogWorkout(workout); setError(""); }}/>
      </section>
    </> : bundle.user?.role === "admin" ? <Settings bundle={bundle} shoes={shoes} onSave={savePreferences} onRename={renameShoes} onUpdateRun={updateRun} onToast={setToast} onMileage={(shoeMileageBase) => setBundle({ ...bundle, shoeMileageBase })} /> : <p className="notice">Admin Settings are available to the administrator account only.</p>}
    <div className="account-actions"><span>Private account</span><form method="post" action="/api/auth/logout"><button className="btn" type="submit">Sign out</button></form></div>
    <footer>Stride keeps your run log in your connected database. Your login is required to access the dashboard.</footer>
    {toast && <div className="toast">{toast}{undoWorkout && <button onClick={() => { const undo = undoWorkout; setUndoWorkout(null); void persist({ ...bundle, plan: bundle.plan.map((item, index) => index === undo.index ? { ...item, status: undo.status } : item) }, "Workout status restored"); }}>Undo</button>}</div>}
    {strengthLogWorkout && <StrengthLogModal
      key={String(strengthLogWorkout.id)}
      workout={strengthLogWorkout}
      defaultLocation={bundle.preferences.defaultLocation}
      onClose={() => setStrengthLogWorkout(null)}
      onSaved={(saved) => {
        setBundle({ ...saved, comments: bundle.comments, shoeMileageBase: bundle.shoeMileageBase, user: bundle.user });
        setStrengthLogWorkout(null);
        setUndoWorkout(null);
        setToast("Strength workout details saved · Training Block progress updated");
      }}
    />}
    {runDialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRunDialog(false); }}><form key={editingRun ? String(editingRun.id ?? editingRun.date + editingRun.name) : completionWorkout ? String(completionWorkout.id ?? completionWorkout.date + completionWorkout.session) : "new-run"} ref={runFormRef} className="modal card" onInput={(event) => updateLivePace(event.currentTarget)} onSubmit={(event) => void submitRun(event)}><div className="modal-head"><div><div className="eyebrow">{completionWorkout ? "WORKOUT COMPLETE" : "RUN LOG"}</div><h2>{editingRun ? "Edit run" : completionWorkout ? "Log actual workout" : "Log a run"}</h2></div><button type="button" className="btn" onClick={() => { setRunDialog(false); setEditingRun(null); setCompletionWorkout(null); }}>Close</button></div>{completionWorkout && <div className="planned-summary"><strong>Planned: {completionWorkout.session}</strong><span>{friendlyDate(trainingDate(completionWorkout, bundle.preferences.raceDate), { month: "long", day: "numeric", year: "numeric" })} · {completionWorkout.target || completionWorkout.pace || "No target specified"}</span><small>Enter what you actually completed below.</small></div>}<div className="run-form"><label>Location<input name="location" required defaultValue={editingRun?.location || bundle.preferences.defaultLocation} onChange={(event) => void fillWeather(event.currentTarget.form)}/></label><label>Date<input type="date" name="date" required defaultValue={editingRun?.date || (completionWorkout ? trainingDate(completionWorkout, bundle.preferences.raceDate) : isoToday())} onChange={(event) => void fillWeather(event.currentTarget.form)}/></label><label>Run name<input name="name" required defaultValue={editingRun?.name || completionWorkout?.session || ""} placeholder="Easy run"/></label><label>Type<select name="type" defaultValue={editingRun?.type || "Easy"}><option>Easy</option><option>Long</option><option>Tempo</option><option>Intervals</option><option>Recovery</option><option>Race</option><option>Other</option></select></label><label>Distance (km)<input type="number" name="distance" min="0.1" step="0.01" required defaultValue={editingRun?.distance ?? ""}/></label><label>Duration<div className="time-parts"><select name="durationHours" aria-label="Duration hours" required onChange={(event) => { const form = event.currentTarget.form; updateFinishTime(form); void fillWeather(form); }} defaultValue={runDurationParts(editingRun?.duration)[0]}>{Array.from({ length: 100 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}</option>)}</select><span>hour</span><select name="durationMinutes" aria-label="Duration minutes" required onChange={(event) => { const form = event.currentTarget.form; updateFinishTime(form); void fillWeather(form); }} defaultValue={runDurationParts(editingRun?.duration)[1]}>{Array.from({ length: 60 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}</option>)}</select><span>min</span><select name="durationSeconds" aria-label="Duration seconds" required onChange={(event) => { const form = event.currentTarget.form; updateFinishTime(form); void fillWeather(form); }} defaultValue={runDurationParts(editingRun?.duration)[2]}>{Array.from({ length: 60 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}</option>)}</select><span>sec</span></div></label><div className="live-pace-readout" aria-live="polite"><span>Calculated pace</span><strong>{livePace ?? (editingRun ? pace(editingRun) : "—")} /km</strong><small>Updates automatically from distance and duration</small></div><label>Average HR<input type="number" name="avgHr" min="1" defaultValue={editingRun?.avgHr ?? ""}/></label><label>Maximum HR<input type="number" name="maxHr" min="1" defaultValue={editingRun?.maxHr ?? ""}/></label><label>Garmin VO₂ Max (optional)<input type="number" name="garminVo2Max" min="10" max="100" step="0.1" inputMode="decimal" placeholder="e.g., 48" defaultValue={editingRun?.garminVo2Max ?? ""} title="Garmin watch / Connect running VO2 max estimate in mL/kg/min"/></label><label>Sleep<div className="time-parts"><select name="sleepHours" aria-label="Sleep hours" defaultValue={runSleepParts(editingRun?.sleep)[0]}>{Array.from({ length: 25 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}</option>)}</select><span>hour</span><select name="sleepMinutes" aria-label="Sleep minutes" defaultValue={runSleepParts(editingRun?.sleep)[1]}>{Array.from({ length: 60 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, "0")}</option>)}</select><span>min</span></div></label><label>Relative effort (Strava)<input type="number" name="effort" min="0" defaultValue={editingRun?.effort ?? ""}/></label><label>RPE (1–10)<input type="number" name="rpe" min="1" max="10" step="0.5" defaultValue={editingRun?.rpe ?? ""} placeholder="How hard did it feel?"/></label><label>ITB during run (0–10)<input name="painDuring" placeholder="0" defaultValue={editingRun?.painDuring ?? ""}/></label><label>ITB next morning (0–10)<input name="painNext" placeholder="0" defaultValue={editingRun?.painNext ?? ""}/></label><label>Shoes<input name="shoes" list="shoe-options" defaultValue={editingRun?.shoes || ""}/><datalist id="shoe-options">{shoes.map((shoe) => <option key={shoe}>{shoe}</option>)}</datalist></label><label>Start time<input type="time" name="startTime" defaultValue={editingRun?.startTime || ""} onChange={(event) => { const form = event.currentTarget.form; updateFinishTime(form); void fillWeather(form); }}/></label><label>Finish time (calculated)<input type="time" name="endTime" readOnly defaultValue={editingRun?.endTime || ""}/></label><label>Temperature at start<input name="weatherStart" placeholder="Auto-filled from hourly weather" defaultValue={editingRun?.weatherStart || ""}/></label><label>Temperature at finish<input name="weatherEnd" placeholder="Auto-filled from hourly weather" defaultValue={editingRun?.weatherEnd || ""}/></label><label className="span-two">Weather during the run<textarea name="weatherDuring" placeholder="Optional notes on conditions" defaultValue={editingRun?.weatherDuring || ""}/></label><label className="span-two">Notes<textarea name="notes" defaultValue={editingRun?.notes || ""}/></label></div><div className="modal-foot"><small>Hourly weather lookup uses your location, date, and times. These are sent to Open-Meteo; you can edit the temperatures manually.</small><span className="weather-status" aria-live="polite">{weatherStatus}</span><button type="button" className="btn" onClick={() => { weatherQuery.current = ""; void fillWeather(runFormRef.current, true); }}>Retry weather</button>{runSaveError && <p role="alert" className="notice error">{runSaveError}</p>}<button className="btn primary" disabled={runSaving}>{runSaving ? "Saving run and workout…" : editingRun ? "Save changes" : completionWorkout ? "Save run and complete workout" : "Save run"}</button></div></form></div>}
    {editingWorkout && <div className="modal-backdrop"><form className="modal card" onSubmit={(event) => void saveWorkout(event)}><div className="modal-head"><div><div className="eyebrow">TRAINING PLAN</div><h2>Edit planned workout</h2></div><button type="button" className="btn" onClick={() => setEditingWorkout(null)}>Close</button></div><div className="settings-form"><label>Date<input type="date" name="date" required defaultValue={trainingDate(editingWorkout, bundle.preferences.raceDate)}/></label><label>Week<input type="number" min="0" name="week" defaultValue={editingWorkout.week}/></label><label>Phase<input name="phase" defaultValue={editingWorkout.phase || ""}/></label><label>Workout<input name="session" required defaultValue={editingWorkout.session}/></label><label>Target<input name="target" defaultValue={editingWorkout.target || ""}/></label><label>Pace<input name="pace" defaultValue={editingWorkout.pace || ""}/></label><label>Heart-rate guidance<input name="hr" defaultValue={editingWorkout.hr || ""}/></label><label className="settings-wide">Coaching notes<textarea name="notes" defaultValue={editingWorkout.notes || ""}/></label></div><div className="modal-foot"><button type="button" className="btn" onClick={() => setEditingWorkout(null)}>Cancel</button><button className="btn primary">Save workout</button></div></form></div>}{detailRun && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailRun(null); }}><section className="modal card run-detail-modal"><div className="modal-head"><div><div className="eyebrow">RUN DETAILS</div><h2>{detailRun.name}</h2></div><button type="button" className="btn" onClick={() => setDetailRun(null)}>Close</button></div><div className="run-detail-grid">{runDetailItems(detailRun).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</div><section className="run-comments"><h3>Run review</h3>{detailRun.analysis && <AnalysisReviewPanel text={detailRun.analysis}/>}<h3>Comments</h3>{(bundle.comments || []).filter((comment) => comment.runId === detailRun.id).map((comment) => <article className="comment" key={comment.id}><p>{comment.text}</p><small>{comment.username} · {new Date(comment.createdAt + "Z").toLocaleString()}</small>{(bundle.user?.role === "admin" || bundle.user?.username === comment.username) && <button className="btn" onClick={() => void removeRunComment(comment.id)}>Delete</button>}</article>)}<form onSubmit={(event) => void postRunComment(event)}><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} maxLength={2000} placeholder="Add a comment" required/><button className="btn primary">Post comment</button></form></section><div className="modal-foot">{bundle.user?.role === "admin" && <><button type="button" className="btn danger" onClick={() => void deleteRun(detailRun)}>Delete run</button><button type="button" className="btn primary" onClick={() => { setEditingRun(detailRun); setCompletionWorkout(null); setDetailRun(null); setWeatherStatus(""); weatherQuery.current = ""; setRunDialog(true); }}>Edit run</button></>}</div></section></div>}
  </main>;
}

function LegacySettings({ bundle, shoes, onSave, onRename, onUpdateRun, onToast }: { bundle: Bundle; shoes: string[]; onSave: (preferences: Preferences) => Promise<void>; onRename: (names: Record<string, string>) => Promise<void>; onUpdateRun: (run: Run, updates: Partial<Run>) => Promise<void>; onToast: (message: string) => void }) {
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
  return <section className="settings-page"><div className="hero"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p className="muted">Manage training preferences, shoe names, run details, and your running LTHR.</p></div></div><div className="settings-grid"><article className="card"><h2>General</h2><p className="muted">{bundle.storage === "Turso" ? "Synced to your connected Turso cloud database." : "Saved in a local SQLite database."}</p><div className="settings-form"><label>Default run location<input value={prefs.defaultLocation} onChange={(event) => setPrefs({ ...prefs, defaultLocation: event.target.value })}/></label><label>Running LTHR (bpm)<input type="number" min="80" max="240" value={prefs.lthr ?? ""} onChange={(event) => setPrefs({ ...prefs, lthr: event.target.value ? Number(event.target.value) : null })} placeholder="Enter your lactate threshold HR"/></label><label>Appearance<select value={prefs.theme} onChange={(event) => setPrefs({ ...prefs, theme: event.target.value as Preferences["theme"] })}><option value="dark">Dark mode</option><option value="light">Light mode</option></select></label><label>Likely race date<select value={prefs.raceDate} onChange={(event) => setPrefs({ ...prefs, raceDate: event.target.value })}><option value="2027-03-14">March 14, 2027</option><option value="2027-03-07">March 7, 2027</option></select></label><label>Training block rows<select value={prefs.planRowCount} onChange={(event) => setPrefs({ ...prefs, planRowCount: Number(event.target.value) })}>{[1, 5, 10, 20, 50, 100].map((number) => <option key={number}>{number}</option>)}</select></label></div><button className="btn primary" onClick={() => void onSave(prefs)}>Save preferences</button></article><article className="card"><h2>Shoe mileage</h2><p className="muted">Rename a shoe and the change applies to all matching runs.</p>{shoes.map((shoe) => <label className="shoe-edit" key={shoe}><span>👟</span><input aria-label={`Shoe name ${shoe}`} value={shoeNames[shoe] ?? shoe} onChange={(event) => setShoeNames({ ...shoeNames, [shoe]: event.target.value })}/></label>)}{!shoes.length && <p className="empty">Log a run to add a shoe.</p>}<button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onRename(shoeNames); setBusy(false); onToast("Shoe names saved"); }}>{busy ? "Saving…" : "Save shoe names"}</button></article><article className="card run-edit-card"><h2>Edit logged run details</h2><p className="muted">Adjust the location, time, manual weather, or notes for a saved run.</p>{sortedRuns.length ? <><label className="run-picker">Run<select value={selectedRun || String(sortedRuns[0].id ?? 0)} onChange={(event) => setSelectedRun(event.target.value)}>{sortedRuns.map((run, index) => <option key={run.id ?? index} value={String(run.id ?? index)}>{friendlyDate(run.date)} · {run.name} · {run.distance} km</option>)}</select></label><div className="settings-form"><label>Run location<input value={runValues.location} onChange={(event) => setRunValues({ ...runValues, location: event.target.value })}/></label><label>Start time<input type="time" value={runValues.startTime} onChange={(event) => setRunValues({ ...runValues, startTime: event.target.value })}/></label><label>Weather at start<input value={runValues.weatherStart} onChange={(event) => setRunValues({ ...runValues, weatherStart: event.target.value })}/></label><label>Weather at finish<input value={runValues.weatherEnd} onChange={(event) => setRunValues({ ...runValues, weatherEnd: event.target.value })}/></label><label className="settings-wide">Weather during the run<textarea value={runValues.weatherDuring} onChange={(event) => setRunValues({ ...runValues, weatherDuring: event.target.value })}/></label><label className="settings-wide">Notes<textarea value={runValues.notes} onChange={(event) => setRunValues({ ...runValues, notes: event.target.value })}/></label></div><button className="btn primary" onClick={() => activeRun && void onUpdateRun(activeRun, runValues)}>Save run details</button></> : <p className="empty">No runs to edit yet.</p>}</article><article className="card privacy-card"><h2>Data & privacy</h2><p>Your run log and preferences are {bundle.storage === "Turso" ? "saved in your connected Turso cloud database" : "saved in a SQLite file on this computer"}. When you request run-time temperatures, Stride sends the entered location, date, and times to Open-Meteo. Weather is an hourly estimate for the matched town, not an exact route reading. AI review sends the selected run details to your chosen provider; provider keys are encrypted in the connected database.</p>{bundle.storage === "Turso" ? <p>Database: <code>Turso cloud</code></p> : <p>Database file: <code>data/stride.sqlite</code></p>}</article></div></section>;
}

function Settings(props: { bundle: Bundle; shoes: string[]; onSave: (preferences: Preferences) => Promise<void>; onRename: (names: Record<string, string>) => Promise<void>; onUpdateRun: (run: Run, updates: Partial<Run>) => Promise<void>; onToast: (message: string) => void; onMileage: (base: Record<string, number>) => void }) {
  const { bundle, shoes, onSave, onRename, onToast, onMileage } = props;
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [keyProvider, setKeyProvider] = useState<Preferences["provider"]>(bundle.preferences.provider);
  const [apiKey, setApiKey] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mileage, setMileage] = useState<Record<string, number>>(bundle.shoeMileageBase || {});
  const [shoeNames, setShoeNames] = useState<Record<string, string>>(() => Object.fromEntries(shoes.map(name => [name, name])));
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { setMileage(bundle.shoeMileageBase || {}); }, [bundle.shoeMileageBase]);
  useEffect(() => { setShoeNames(old => Object.fromEntries(shoes.map(name => [name, old[name] ?? name]))); }, [shoes]);
  async function refresh() {
    const response = await fetch("/api/admin", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setAccounts(data.accounts || []); setSavedKeys(data.savedKeys || {}); setMileage(data.shoeMileageBase || {});
  }
  async function sendAdmin(body: object) {
    setAdminBusy(true); setAdminError("");
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this change.");
      await refresh(); return result;
    } catch (reason) { setAdminError(reason instanceof Error ? reason.message : "Could not save this change."); return null; }
    finally { setAdminBusy(false); }
  }
  return <><BackupManager onToast={onToast}/><section className="card admin-card"><h2>AI provider and saved keys</h2><p className="muted">Stride encrypts these keys in the database. They stay on the server and are never sent back to the browser.</p><div className="settings-form"><label>Provider<select value={bundle.preferences.provider} onChange={(event) => { const provider = event.target.value as Preferences["provider"]; setKeyProvider(provider); void onSave({ ...bundle.preferences, provider, model: modelOptions[provider][0][0] }); }}><option value="openai">ChatGPT / OpenAI</option><option value="gemini">Google Gemini</option><option value="anthropic">Claude</option></select></label><label>Model<select value={bundle.preferences.model} onChange={(event) => void onSave({ ...bundle.preferences, model: event.target.value })}>{modelOptions[bundle.preferences.provider].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Provider API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={savedKeys[keyProvider] ? "A key is saved; enter to replace" : "Paste provider API key"}/></label></div><button className="btn primary" disabled={adminBusy || !apiKey.trim()} onClick={async () => { const result = await sendAdmin({ action: "save-api-key", provider: keyProvider, apiKey }); if (result) { setApiKey(""); onToast("Encrypted API key saved"); } }}>Save API key</button><span className="muted">{savedKeys[bundle.preferences.provider] ? "Selected provider key is saved" : "No key saved for the selected provider"}</span></section>
    <section className="card admin-card"><h2>Viewer accounts</h2><p className="muted">Accounts can see runs and planned sessions and leave comments. They cannot change your training data or settings.</p><form className="workout-form" onSubmit={(event) => { event.preventDefault(); void sendAdmin({ action: "create-account", username: newUsername, password: newPassword }).then((result) => { if (result) { setNewUsername(""); setNewPassword(""); onToast("Viewer account created"); } }); }}><input aria-label="New username" minLength={3} maxLength={32} value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="Username" required/><input aria-label="Temporary password" type="password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Password (12+ characters)" required/><button className="btn primary" disabled={adminBusy}>Create viewer</button></form>{accounts.map((account) => <div className="account-row" key={account.id}><span>{account.username} <small>Viewer</small></span><button className="btn danger" disabled={adminBusy} onClick={async () => { if (!window.confirm(`Remove viewer account “${account.username}”?`)) return; const result = await sendAdmin({ action: "delete-account", id: account.id }); if (result) onToast("Viewer account removed"); }}>Remove</button></div>)}</section>
    <section className="card admin-card"><h2>Rename shoes</h2><p className="muted">Edit shoe names and select Save. Changes apply to past run entries and the mileage summary. Renaming Superlast 2 to Superblast 2 combines their mileage.</p>{shoes.map(name => <label className="shoe-edit" key={name}><span>👟</span><span className="shoe-original-name">{name}</span><input aria-label={"Rename " + name} value={shoeNames[name] ?? name} onChange={event => setShoeNames(old => ({ ...old, [name]: event.target.value }))}/></label>)}<button type="button" className="btn primary" disabled={adminBusy || !shoes.some(name => (shoeNames[name] || "").trim() !== name)} onClick={async () => { const changes = Object.fromEntries(shoes.filter(name => (shoeNames[name] || "").trim() && shoeNames[name]?.trim() !== name).map(name => [name, shoeNames[name].trim()])); if (Object.keys(changes).length) await onRename(changes); }}>Save shoe names</button></section>
    <section className="card admin-card"><h2>Shoe mileage</h2><p className="muted">Set starting mileage for past runs. New logged runs add to these totals automatically.</p>{shoes.map((shoe) => <label className="shoe-edit" key={shoe}><span>👟</span><span>{shoe}</span><input type="number" min="0" step="0.1" aria-label={`${shoe} starting mileage`} value={mileage[shoe] ?? 0} onChange={(event) => setMileage({ ...mileage, [shoe]: Number(event.target.value) || 0 })}/><small>km starting mileage</small></label>)}<button className="btn primary" disabled={adminBusy} onClick={async () => { const result = await sendAdmin({ action: "save-mileage", mileage }); if (result) { onMileage(mileage); onToast("Shoe mileage saved"); } }}>Save starting mileage</button></section>
    <section className="card admin-card"><h2>Run reminders</h2><p className="muted">Browser notifications are scheduled while Stride is open in this browser. Your browser may ask permission.</p><div className="settings-form"><label>Remind me before a workout<select value={bundle.preferences.notificationLeadHours ?? 24} onChange={(event) => void onSave({ ...bundle.preferences, notificationLeadHours: Number(event.target.value) })}><option value={1}>1 hour</option><option value={3}>3 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={48}>2 days</option></select></label></div><button className="btn primary" onClick={async () => { if (!("Notification" in window)) { setAdminError("This browser does not support notifications."); return; } const permission = await Notification.requestPermission(); if (permission !== "granted") { setAdminError("Notification permission was not granted."); return; } await onSave({ ...bundle.preferences, notificationsEnabled: true }); onToast("Run reminders enabled in this browser"); }}>Enable browser notifications</button>{bundle.preferences.notificationsEnabled && <button className="btn" onClick={() => void onSave({ ...bundle.preferences, notificationsEnabled: false })}>Turn reminders off</button>}</section>
    <RecoverMissingRuns/>{adminError && <p className="error">{adminError}</p>}<LegacySettings {...props}/></>;
}
