import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getBundle } from "@/lib/database";
import AnalysisMarkdown from "@/components/analysis-markdown";

export const dynamic = "force-dynamic";

export default async function RunReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ reviewId?: string }>;
}) {
  const [{ runId }, { reviewId }, user] = await Promise.all([
    params,
    searchParams,
    currentUser(),
  ]);
  if (!user)
    redirect(
      `/login?next=${encodeURIComponent(`/reviews/${runId}${reviewId ? `?reviewId=${reviewId}` : ""}`)}`,
    );
  const run = (await getBundle()).runs.find(
    (item) => String(item.id) === runId,
  );
  if (!run) notFound();

  const review = reviewId
    ? run.analysisHistory?.find((item) => item.id === reviewId)
    : [...(run.analysisHistory || [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
  const text = review?.text || (!reviewId ? run.analysis : "");
  if (!text) notFound();

  return (
    <main className="review-page shell">
      <header className="review-page-head">
        <a className="brand" href="/">
          <span className="brand-mark">↗</span>
          <span>
            stride<span className="lime">.</span>
          </span>
        </a>
        <a className="btn" href="/">
          Back to dashboard
        </a>
      </header>
      <article className="card review-full-card">
        <div className="eyebrow">RUN REVIEW</div>
        <h1>{run.name}</h1>
        <p className="muted">
          {new Date(`${run.date}T12:00:00`).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {run.distance} km
          {review
            ? ` · ${review.model} · ${new Date(review.createdAt).toLocaleString()}`
            : ""}
        </p>
        <div className="review-full-text">
          <AnalysisMarkdown text={text} title="Run review" />
        </div>
      </article>
    </main>
  );
}
