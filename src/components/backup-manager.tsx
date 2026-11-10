"use client";

import { useEffect, useState } from "react";

type RecoveryPoint = {
  id: string;
  label: string;
  createdAt: string;
  kind: "pre-import" | "manual" | "before-restore";
  runs: number;
  workouts: number;
  totalRows: number;
};

export default function BackupManager({ onToast }: { onToast: (message: string) => void }) {
  const [points, setPoints] = useState<RecoveryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restore, setRestore] = useState<RecoveryPoint | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function loadPoints() {
    setLoading(true);
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load recovery points.");
      setPoints(data.points || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load recovery points.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadPoints(); }, []);

  async function createBackup() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/backups", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a backup.");
      await loadPoints();
      onToast("New database recovery point saved. Download a copy for safekeeping.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create recovery point.");
    } finally { setBusy(false); }
  }

  async function restorePlan() {
    if (!restore || confirmation !== "RESTORE PLAN") return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/backups/restore-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: restore.id, confirm: confirmation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not restore the selected plan.");
      setRestore(null); setConfirmation("");
      // Refresh the authoritative plan and counters after the server commits.
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not restore the selected plan.");
    } finally { setBusy(false); }
  }

  return <section className="card admin-card backup-manager" aria-label="Backups and restore">
    <div className="backup-manager-header">
      <div>
        <h2>Backups &amp; Restore</h2>
        <p className="muted">Create and download recovery points, or restore a future Training Block without deleting newer run records.</p>
      </div>
      <button className="btn primary" disabled={busy} onClick={() => void createBackup()}>
        {busy ? "Working…" : "Create backup now"}
      </button>
    </div>
    <p className="muted backup-private-note">Recovery points are saved in the same Stride database. Download a separate copy for disaster recovery. Backups contain private running records and sensitive credentials; Vercel environment variables are not included.</p>
    {loading ? <p className="muted">Loading recovery points…</p> : points.length ? <div className="backup-list">
      {points.map(point => <div className="backup-entry" key={point.id}>
        <div className="backup-description">
          <strong>{point.label}</strong>
          <small>{point.createdAt ? new Date(point.createdAt.endsWith("Z") ? point.createdAt : point.createdAt.replace(" ", "T") + "Z").toLocaleString() : "Unknown date"} · {point.runs} run records · {point.workouts} workout records</small>
          <small>{point.kind === "pre-import" ? "Historical checkpoint" : point.kind === "before-restore" ? "Before plan restore" : "Manual recovery point"}</small>
        </div>
        <div className="backup-actions">
          <a className="btn" download href={"/api/backups/" + encodeURIComponent(point.id)} title="Download private full database backup">Download</a>
          <button className="btn" type="button" disabled={busy || point.workouts === 0} onClick={() => { setRestore(point); setConfirmation(""); setError(""); }}>
            Restore plan
          </button>
        </div>
      </div>)}
    </div> : <p className="muted">No recovery points yet. Choose Create backup now to save one.</p>}
    <p className="muted">Restore plan changes future workout prescriptions only. Completed workouts, today and earlier dates, Run History, accounts, and settings are preserved. A new backup is created automatically before restoration. For a complete database recovery, download the file and restore it through a reviewed recovery procedure rather than overwriting newer records here.</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {restore && <div className="backup-restore-confirm">
      <h3>Restore future plan from “{restore.label}”?</h3>
      <p>This archives other future planned sessions, then reinstates future workouts from the selected backup. It does not delete runs or completed sessions. A full recovery point is saved before this change.</p>
      <label>Type <strong>RESTORE PLAN</strong> to confirm
        <input aria-label="Confirm restore plan" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" placeholder="RESTORE PLAN"/>
      </label>
      <div className="backup-actions">
        <button className="btn" type="button" disabled={busy} onClick={() => { setRestore(null); setConfirmation(""); }}>Cancel</button>
        <button className="btn danger" type="button" disabled={busy || confirmation !== "RESTORE PLAN"} onClick={() => void restorePlan()}>
          {busy ? "Restoring…" : "Restore future plan"}
        </button>
      </div>
    </div>}
  </section>;
}
