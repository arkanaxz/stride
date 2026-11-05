import { notFound, redirect } from "next/navigation";
import AnalysisMarkdown from "@/components/analysis-markdown";
import { currentUser } from "@/lib/auth";
import { getBundle, getComments } from "@/lib/database";
import type { Run } from "@/lib/types";

export const dynamic = "force-dynamic";

function pace(run: Run) {
  if (!run.distance || !run.duration) return "—";
  const minutes = run.duration / run.distance;
  return `${Math.floor(minutes)}:${String(Math.round((minutes % 1) * 60)).padStart(2, "0")} /km`;
}

function duration(minutes: number) {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function sleep(hours?: number | null) {
  if (hours == null) return "—";
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const [{ runId }, user] = await Promise.all([params, currentUser()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/history/${runId}`)}`);
  const [bundle, comments] = await Promise.all([getBundle(), getComments()]);
  const run = bundle.runs.find((item) => String(item.id) === runId);
  if (!run) notFound();

  const fields: [string, string][] = [
    [
      "Date",
      new Date(`${run.date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    ],
    ["Type", run.type || "—"],
    ["Distance", `${Number(run.distance).toFixed(2)} km`],
    ["Duration", duration(Number(run.duration || 0))],
    ["Pace", pace(run)],
    ["Average HR", run.avgHr ? `${run.avgHr} bpm` : "—"],
    ["Maximum HR", run.maxHr ? `${run.maxHr} bpm` : "—"],
    ["Sleep", sleep(run.sleep)],
    ["Relative effort", run.effort == null ? "—" : String(run.effort)],
    [
      "ITB during",
      run.painDuring || (run.pain == null ? "—" : String(run.pain)),
    ],
    ["ITB next morning", run.painNext || "—"],
    ["Location", run.location || "—"],
    ["Start time", run.startTime || "—"],
    ["Finish time", run.endTime || "—"],
    ["Temperature at start", run.weatherStart || "—"],
    ["Temperature at finish", run.weatherEnd || "—"],
    ["Weather during", run.weatherDuring || "—"],
    ["Imported weather note", run.weatherRoute || "—"],
    ["Shoes", run.shoes || "—"],
    ["Notes", run.notes || "—"],
  ];
  const reviews = [...(run.analysisHistory || [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const runComments = comments.filter((comment) => comment.runId === run.id);

  return (
    <main className="review-page shell">
      <header className="review-page-head">
        <a className="brand" href="/">
          <span className="brand-mark">↗</span>
          <span>
            stride<span className="lime">.</span>
          </span>
        </a>
        <div className="detail-page-actions">
          <a className="btn" href="/history">
            Run history
          </a>
          <a className="btn" href="/">
            Back to dashboard
          </a>
        </div>
      </header>
      <article className="card run-detail-page">
        <div className="eyebrow">RUN DETAILS</div>
        <h1>{run.name || "Run"}</h1>
        <p className="muted">
          Complete metrics, notes, saved reviews, and comments.
        </p>
        <dl className="history-run-details detail-page-grid">
          {fields.map(([label, value]) => (
            <div
              className={
                label === "Notes" ||
                label === "Weather during" ||
                label === "Imported weather note"
                  ? "detail-wide"
                  : ""
              }
              key={label}
            >
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {(reviews.length > 0 || run.analysis) && (
          <section className="detail-section">
            <h2>AI reviews</h2>
            {reviews.length ? (
              reviews.map((review, index) => (
                <AnalysisMarkdown
                  key={review.id}
                  text={review.text}
                  title={`${review.model || review.provider} · ${new Date(review.createdAt).toLocaleString()}`}
                  initiallyOpen={index === 0}
                />
              ))
            ) : (
              <AnalysisMarkdown
                text={run.analysis || ""}
                title="Saved run review"
              />
            )}
          </section>
        )}
        <section className="detail-section">
          <h2>Comments</h2>
          {runComments.length ? (
            runComments.map((comment) => (
              <article className="comment" key={comment.id}>
                <p>{comment.text}</p>
                <small>
                  {comment.username} ·{" "}
                  {new Date(`${comment.createdAt}Z`).toLocaleString()}
                </small>
              </article>
            ))
          ) : (
            <p className="muted">No comments on this run.</p>
          )}
        </section>
      </article>
    </main>
  );
}
