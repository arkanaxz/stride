"use client";

import { useMemo, useState } from "react";
import type { Run } from "@/lib/types";
import ThemeToggle from "@/components/theme-toggle";

function pace(run: Run) {
  if (!run.distance || !run.duration) return "—";
  const minutes = run.duration / run.distance;
  return `${Math.floor(minutes)}:${String(Math.round(minutes % 1 * 60)).padStart(2, "0")}`;
}

function duration(minutes: number) {
  const seconds = Math.round(minutes * 60);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")} hour ${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")} min ${String(seconds % 60).padStart(2, "0")} sec`;
}

function sleep(hours?: number | null) {
  if (hours == null) return "—";
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)} hour ${String(minutes % 60).padStart(2, "0")} min`;
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function RunHistoryPage({ runs }: { runs: Run[] }) {
  const [search, setSearch] = useState("");
  const filteredRuns = useMemo(() => [...runs].sort((a, b) => b.date.localeCompare(a.date)).filter((run) => !search.trim() || Object.values(run).some((value) => JSON.stringify(value ?? "").toLowerCase().includes(search.trim().toLowerCase()))), [runs, search]);

  return <main className="shell history-page">
    <header className="review-page-head"><a className="brand" href="/"><span className="brand-mark">↗</span><span>stride<span className="lime">.</span></span></a><div className="review-header-actions"><ThemeToggle/><a className="btn" href="/">Back to dashboard</a></div></header>
    <div className="hero"><div><div className="eyebrow">YOUR TRAINING LOG</div><h1>Run history</h1><p className="muted">{filteredRuns.length} of {runs.length} runs · Select a run to expand its details.</p></div></div>
    <label className="history-search">Search runs<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, date, shoes, notes…" /></label>
    <section className="history-run-list">{filteredRuns.map((run, index) => {
      const fields: [string, string][] = [
        ["Date", dateLabel(run.date)], ["Type", run.type || "—"], ["Distance", `${Number(run.distance).toFixed(2)} km`], ["Duration", duration(Number(run.duration || 0))], ["Pace", `${pace(run)} /km`],
        ["Average HR", run.avgHr ? `${run.avgHr} bpm` : "—"], ["Maximum HR", run.maxHr ? `${run.maxHr} bpm` : "—"], ["Sleep", sleep(run.sleep)], ["Relative effort", run.effort == null ? "—" : String(run.effort)],
        ["ITB during", run.painDuring || (run.pain == null ? "—" : String(run.pain))], ["ITB next morning", run.painNext || "—"], ["Location", run.location || "—"], ["Start time", run.startTime || "—"], ["Finish time", run.endTime || "—"],
        ["Temperature at start", run.weatherStart || "—"], ["Temperature at finish", run.weatherEnd || "—"], ["Weather during", run.weatherDuring || "—"], ["Shoes", run.shoes || "—"], ["Notes", run.notes || "—"],
      ];
      return <details className="history-run card" key={run.id ?? `${run.date}-${index}`}>
        <summary><span><strong>{run.name || "Run"}</strong><small>{dateLabel(run.date)} · {run.type}</small></span><span>{Number(run.distance).toFixed(2)} km · {pace(run)} /km</span></summary>
        <dl className="history-run-details">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {run.analysisHistory?.length ? <div className="history-reviews"><strong>AI reviews</strong>{[...run.analysisHistory].reverse().map((review, reviewIndex) => <a className="btn" href={`/reviews/${run.id}?reviewId=${encodeURIComponent(review.id)}`} target="_blank" rel="noreferrer" key={review.id}>{review.model || review.provider} · {new Date(review.createdAt).toLocaleString()} · Open review ↗{reviewIndex === 0 ? " (latest)" : ""}</a>)}</div> : run.analysis ? <a className="btn review-open" href={`/reviews/${run.id}`} target="_blank" rel="noreferrer">Open saved review ↗</a> : null}
      </details>;
    })}{filteredRuns.length === 0 && <p className="empty card">{runs.length ? "No runs match your search." : "No logged runs yet."}</p>}</section>
  </main>;
}
