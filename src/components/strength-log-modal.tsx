"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Bundle, StrengthLog, Workout } from "@/lib/types";

function durationParts(minutes: number | undefined): [number, number, number] {
  const seconds = Math.max(0, Math.round(Number(minutes || 0) * 60));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
}
function sleepParts(hours: number | null | undefined): [number, number] {
  const mins = Math.round(Number(hours || 0) * 60);
  return [Math.floor(mins / 60), mins % 60];
}
function finishTime(form: HTMLFormElement | null) {
  if (!form) return;
  const data = new FormData(form);
  const start = String(data.get("startTime") || "");
  const target = form.elements.namedItem("endTime") as HTMLInputElement | null;
  if (!target) return;
  const mins = Number(data.get("durationHours")) * 60 + Number(data.get("durationMinutes")) + Number(data.get("durationSeconds")) / 60;
  if (!start || mins <= 0) { target.value = ""; return; }
  const parts = start.split(":").map(Number);
  const time = (parts[0] * 60 + parts[1] + Math.round(mins)) % 1440;
  target.value = String(Math.floor(time / 60)).padStart(2, "0") + ":" + String(time % 60).padStart(2, "0");
}

export default function StrengthLogModal({
  workout, defaultLocation, onClose, onSaved,
}: {
  workout: Workout;
  defaultLocation: string;
  onClose: () => void;
  onSaved: (bundle: Bundle) => void;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const prior = workout.strengthLog;
  const [h, m, s] = durationParts(prior?.duration);
  const [sleepH, sleepM] = sleepParts(prior?.sleep);
  const kind = workout.session.includes("Strength B") ? "Strength B" :
    workout.session.includes("Strength A") ? "Strength A" : "Strength / mobility";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const log: StrengthLog = {
      date: String(form.get("date") || ""),
      name: String(form.get("name") || ""),
      type: String(form.get("type") || ""),
      duration: Number(form.get("durationHours")) * 60 +
        Number(form.get("durationMinutes")) + Number(form.get("durationSeconds")) / 60,
      avgHr: form.get("avgHr") ? Number(form.get("avgHr")) : null,
      maxHr: form.get("maxHr") ? Number(form.get("maxHr")) : null,
      sleep: Number(form.get("sleepHours")) + Number(form.get("sleepMinutes")) / 60 || null,
      rpe: form.get("rpe") ? Number(form.get("rpe")) : null,
      painDuring: String(form.get("painDuring") || ""),
      painNext: String(form.get("painNext") || ""),
      location: String(form.get("location") || ""),
      startTime: String(form.get("startTime") || ""),
      endTime: String(form.get("endTime") || ""),
      weatherDuring: String(form.get("weatherDuring") || ""),
      exercises: String(form.get("exercises") || ""),
      notes: String(form.get("notes") || ""),
    };
    if (log.duration <= 0) { setError("Enter a strength workout duration greater than zero."); return; }
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/strength-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id, log }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the strength workout.");
      const saved = result as Bundle;
      const confirmed = saved.plan.find(item => String(item.id) === String(workout.id));
      if (confirmed?.status !== "completed" || !confirmed.strengthLog) {
        throw new Error("Strength session could not be verified as saved. Refresh Stride before retrying.");
      }
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this strength workout.");
    } finally { inFlight.current = false; setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form key={String(workout.id)} ref={formRef} className="modal card strength-log-modal" onSubmit={event => void submit(event)}>
      <div className="modal-head">
        <div><div className="eyebrow">STRENGTH TRAINING</div><h2>{prior ? "View / edit strength details" : workout.status === "completed" ? "Add completed strength details" : "Log strength workout as done"}</h2></div>
        <button type="button" className="btn" disabled={saving} onClick={onClose}>Close</button>
      </div>
      <div className="planned-summary">
        <strong>Planned: {workout.session}</strong>
        <span>{workout.target || "Strength training / mobility"}</span>
        {workout.strength && <details><summary>View planned exercises</summary><p className="strength-prescription-text">{workout.strength}</p></details>}
      </div>
      <p className="muted">Strength workouts are saved with your Training Block. They never add running mileage, pace, or VO₂ Max measurements.</p>
      <div className="run-form">
        <label>Location<input name="location" required defaultValue={prior?.location || defaultLocation}/></label>
        <label>Date<input type="date" name="date" required defaultValue={prior?.date || workout.date}/></label>
        <label>Workout name<input name="name" required defaultValue={prior?.name || workout.session}/></label>
        <label>Type<select name="type" defaultValue={prior?.type || kind}><option>Strength A</option><option>Strength B</option><option>Strength / mobility</option><option>Mobility</option><option>Other</option></select></label>
        <label>Duration<div className="time-parts">
          <select name="durationHours" aria-label="Strength duration hours" defaultValue={h} onChange={event => finishTime(event.currentTarget.form)}>{Array.from({ length: 25 },(_,n)=><option value={n} key={n}>{String(n).padStart(2,"0")}</option>)}</select><span>hour</span>
          <select name="durationMinutes" aria-label="Strength duration minutes" defaultValue={m} onChange={event => finishTime(event.currentTarget.form)}>{Array.from({ length: 60 },(_,n)=><option value={n} key={n}>{String(n).padStart(2,"0")}</option>)}</select><span>min</span>
          <select name="durationSeconds" aria-label="Strength duration seconds" defaultValue={s} onChange={event => finishTime(event.currentTarget.form)}>{Array.from({ length: 60 },(_,n)=><option value={n} key={n}>{String(n).padStart(2,"0")}</option>)}</select><span>sec</span>
        </div></label>
        <label>Average HR<input name="avgHr" type="number" min="1" max="250" defaultValue={prior?.avgHr ?? ""}/></label>
        <label>Maximum HR<input name="maxHr" type="number" min="1" max="250" defaultValue={prior?.maxHr ?? ""}/></label>
        <label>Sleep<div className="time-parts">
          <select name="sleepHours" aria-label="Strength sleep hours" defaultValue={sleepH}>{Array.from({ length: 25 },(_,n)=><option value={n} key={n}>{String(n).padStart(2,"0")}</option>)}</select><span>hour</span>
          <select name="sleepMinutes" aria-label="Strength sleep minutes" defaultValue={sleepM}>{Array.from({ length: 60 },(_,n)=><option value={n} key={n}>{String(n).padStart(2,"0")}</option>)}</select><span>min</span>
        </div></label>
        <label>RPE (1–10)<input name="rpe" type="number" min="1" max="10" step="0.5" defaultValue={prior?.rpe ?? ""} placeholder="How hard did it feel?"/></label>
        <label>ITB during workout (0–10)<input name="painDuring" defaultValue={prior?.painDuring || ""} placeholder="0"/></label>
        <label>ITB next morning (0–10)<input name="painNext" defaultValue={prior?.painNext || ""} placeholder="0"/></label>
        <label>Start time<input type="time" name="startTime" defaultValue={prior?.startTime || ""} onChange={event => finishTime(event.currentTarget.form)}/></label>
        <label>Finish time (calculated)<input type="time" name="endTime" defaultValue={prior?.endTime || ""} readOnly/></label>
        <label className="span-two">Weather during workout<textarea name="weatherDuring" defaultValue={prior?.weatherDuring || ""} placeholder="Optional notes about conditions"/></label>
        <label className="span-two">Exercises completed / sets / reps / weight<textarea name="exercises" defaultValue={prior?.exercises || ""} placeholder="E.g., 3 × 12 glute bridges, 2 × 15 calf raises"/></label>
        <label className="span-two">Notes<textarea name="notes" defaultValue={prior?.notes || ""}/></label>
      </div>
      <div className="modal-foot">
        <small>Saved with the strength workout — not Run History. Running mileage remains unchanged.</small>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn primary" disabled={saving}>{saving ? "Saving strength workout…" : prior ? "Save strength changes" : "Save strength workout and mark Done"}</button>
      </div>
    </form>
  </div>;
}
