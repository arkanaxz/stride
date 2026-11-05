"use client";

import { useState } from "react";

type Preview = {
  preview: true;
  count: number;
  foundInBackup: number;
  alreadyPresent: number;
  liveRunCount: number;
  missing: {
    date: string; name: string; distance: number; duration: number; savedReview: boolean;
  }[];
  message: string;
};

export default function RecoverMissingRuns() {
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceToken, setSourceToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function inspect(action: "preview" | "restore") {
    if (action === "restore") {
      if (!preview || !preview.count) return;
      const confirmation = window.confirm(
        "Recover " + preview.count + " missing run(s) from the separate Turso backup?\n\n" +
        "This operation INSERTS missing runs only. It does not replace existing runs or workouts."
      );
      if (!confirmation) return;
    }
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/recover-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sourceUrl, sourceToken }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Recovery request failed.");
      if (action === "preview") setPreview(result as Preview);
      else {
        setPreview(null);
        setSuccess("Recovered " + result.restored + " run(s). Refreshing Stride…");
        // Never retain the source token in storage. Reload to display the
        // authoritative live Run History after the insert.
        setSourceToken("");
        window.location.reload();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not recover runs."); }
    finally { setBusy(false); }
  }

  return <section className="card admin-card run-recovery-card">
    <h2>Recover missing runs (Oct 29, Oct 30, Nov 3, Nov 4)</h2>
    <p className="muted">
      Use a separate Turso point-in-time recovery database from before the runs disappeared.
      First create that database in Turso; do not restore it over Stride's live database or change Vercel settings.
      Preview compares only these four dates. The final action adds missing runs without modifying existing records.
    </p>
    <div className="settings-form">
      <label>Recovery database URL
        <input type="url" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); setPreview(null); }} placeholder="libsql://your-recovery-db.turso.io" autoComplete="off"/>
      </label>
      <label>Recovery database authentication token
        <input type="password" value={sourceToken} onChange={event => { setSourceToken(event.target.value); setPreview(null); }} placeholder="Paste a token for the recovery database" autoComplete="off"/>
      </label>
    </div>
    <p className="muted">The recovery credentials are used for this request only; they are not saved in your browser or Stride's settings.</p>
    <button type="button" className="btn" disabled={busy || !sourceUrl.trim() || !sourceToken.trim()} onClick={() => void inspect("preview")}>
      {busy ? "Checking backup…" : "Preview recovery"}
    </button>
    {preview && <div className="run-recovery-preview">
      <strong>Backup comparison</strong>
      <p>{preview.foundInBackup} runs found on the selected dates · {preview.alreadyPresent} already in Stride · {preview.count} missing</p>
      {preview.missing.map((run, index) => <div key={run.date + run.name + index} className="recovery-row">
        {run.date} · {run.name} · {run.distance.toFixed(2)} km · {run.savedReview ? "AI review included" : "No saved AI review"}
      </div>)}
      {preview.count > 0 ? <button type="button" className="btn primary" disabled={busy} onClick={() => void inspect("restore")}>
        Restore these {preview.count} missing run(s)
      </button> : <p className="muted">No missing runs found at that backup timestamp. Try an earlier separate recovery point.</p>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {success && <p role="status">{success}</p>}
  </section>;
}
