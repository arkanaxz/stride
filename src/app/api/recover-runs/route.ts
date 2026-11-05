import { createClient } from "@libsql/client";
import { currentUser } from "@/lib/auth";
import { appendRunHistorySafely, getBundle } from "@/lib/database";
import type { Run } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
const missingDates = ["2026-10-29", "2026-10-30", "2026-11-03", "2026-11-04"];

function identity(run: Run) {
  return [run.date, run.name, Number(run.distance || 0), Number(run.duration || 0)].join("|");
}

function validRestoreDatabaseUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 600) return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    if (!["libsql:", "https:"].includes(url.protocol) || !host.endsWith(".turso.io") || !host.split(".").every(Boolean)) return null;
    if (url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) return null;
    if ((process.env.TURSO_DATABASE_URL || process.env.stride_TURSO_DATABASE_URL || "").trim() === raw.trim()) return null;
    return raw.trim();
  } catch { return null; }
}

type RecoveryRequest = {
  action?: "preview" | "restore";
  sourceUrl?: string;
  sourceToken?: string;
};

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  let payload: RecoveryRequest;
  try { payload = await request.json() as RecoveryRequest; }
  catch { return Response.json({ error: "Recovery request must be valid JSON." }, { status: 400 }); }
  if (payload.action !== "preview" && payload.action !== "restore") return Response.json({ error: "Choose preview or restore." }, { status: 400 });
  const url = validRestoreDatabaseUrl(payload.sourceUrl);
  const token = typeof payload.sourceToken === "string" ? payload.sourceToken.trim() : "";
  if (!url || !token || token.length > 6000) {
    return Response.json({ error: "Provide the URL and token for a separate Turso recovery database (not your live database)." }, { status: 400 });
  }
  try {
    // This client is used for SELECT ONLY and never saved in environment,
    // cookies, logs, or browser localStorage. The live database remains unchanged
    // for preview requests.
    const source = createClient({ url, authToken: token });
    const result = await source.execute({
      sql: "SELECT id, payload FROM runs WHERE json_extract(payload, '$.date') IN (?, ?, ?, ?) ORDER BY id",
      args: missingDates,
    });
    const recovered: Run[] = result.rows.flatMap((row): Run[] => {
      try {
        const data = JSON.parse(String(row.payload)) as Run;
        if (!missingDates.includes(data.date) || !data.name || !(Number(data.distance) > 0) || !(Number(data.duration) > 0)) return [];
        return [{ ...data, id: undefined }];
      } catch { return []; }
    });
    const live = await getBundle();
    const existing = new Set(live.runs.map(identity));
    const missing: Run[] = [];
    for (const run of recovered) {
      const key = identity(run);
      if (existing.has(key)) continue;
      existing.add(key);
      missing.push(run);
    }

    if (payload.action === "preview") {
      return Response.json({
        preview: true,
        dateScope: missingDates,
        foundInBackup: recovered.length,
        alreadyPresent: recovered.length - missing.length,
        missing: missing.map(run => ({
          date: run.date,
          name: run.name,
          distance: run.distance,
          duration: run.duration,
          savedReview: Boolean(run.analysis || run.analysisHistory?.length),
        })),
        count: missing.length,
        liveRunCount: live.runs.length,
        message: "Preview only: no runs, workouts or settings have been changed.",
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!missing.length) return Response.json({ restored: 0, runCount: live.runs.length, message: "No missing runs were found in this recovery database." });
    // This helper ONLY INSERTS missing Run records; existing IDs and all
    // plan, settings, reviews, and credentials are preserved.
    const appended = await appendRunHistorySafely(missing);
    return Response.json({
      restored: appended.added,
      runCount: appended.bundle.runs.length,
      dates: missing.map(run => run.date),
      message: "Only previously missing runs were added; existing history and training plan were untouched.",
    });
  } catch {
    return Response.json({
      error: "Could not read the recovery database or safely add its missing runs. Check the recovery database URL/token. No whole-table Run History replacement was performed.",
    }, { status: 502 });
  }
}
