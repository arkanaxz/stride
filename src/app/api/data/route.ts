import { currentUser } from "@/lib/auth";
import { ensureSub2034WeekPlan, ensureVerifiedGarminRunRecovery, reconcileNov3WorkoutCompletion, completeWorkoutWithRunSafely, getBundle, getComments, saveBundle, updateRunHistorySafely, RunHistoryConflictError } from "@/lib/database";
import type { Bundle, Run } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  await ensureSub2034WeekPlan();
  await ensureVerifiedGarminRunRecovery();
  await reconcileNov3WorkoutCompletion();
  const [bundle, comments] = await Promise.all([getBundle(), getComments()]);
  let shoeMileageBase: Record<string, number> = {};
  try { shoeMileageBase = JSON.parse(String(bundle.meta.shoeMileageBase || "{}")) as Record<string, number>; } catch { /* no baseline saved */ }
  return Response.json({ ...bundle, comments, shoeMileageBase, user: { username: user.username, role: user.role } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const incoming = await request.json() as Partial<Bundle> & { kind?: string; workoutId?: string; run?: Run };
  if (incoming.kind === "complete-workout") {
    try {
      const completed = await completeWorkoutWithRunSafely(String(incoming.workoutId || ""), incoming.run!);
      const comments = await getComments();
      let shoeMileageBase: Record<string, number> = {};
      try { shoeMileageBase = JSON.parse(String(completed.bundle.meta.shoeMileageBase || "{}")) as Record<string, number>; } catch { /* keep existing baseline */ }
      return Response.json({
        ...completed.bundle, comments, shoeMileageBase,
        user: { username: user.username, role: user.role },
        loggedRunId: completed.runId,
        insertedRun: completed.inserted,
      });
    } catch (reason) {
      if (reason instanceof RunHistoryConflictError) return Response.json({ error: reason.message }, { status: 409 });
      // Log a correlation ID for server-side diagnosis without exposing
      // database URLs, access tokens or run payloads to the browser.
      const reference = crypto.randomUUID().slice(0, 8);
      console.error("[Stride complete-workout]", reference, reason instanceof Error ? reason.message : "Unknown error");
      return Response.json({ error: "Workout save failed (" + reference + "). Your run was not intentionally saved separately; refresh to check before retrying." }, { status: 500 });
    }
  }
  if (incoming.kind === "bootstrap") {
    // Never migrate stale browser storage over an existing server database.
    // Return the authoritative data to older clients without writing anything.
    const [bundle, comments] = await Promise.all([getBundle(), getComments()]);
    return Response.json({ ...bundle, comments, user: { username: user.username, role: user.role } });
  }
  return Response.json({ error: "Unsupported request." }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const requestBody = await request.json() as Partial<Bundle> & { baseRuns?: Bundle["runs"]; basePlan?: Bundle["plan"] };
  const changed: Partial<Bundle> = {};
  if (Array.isArray(requestBody.plan)) {
    if (!Array.isArray(requestBody.basePlan)) return Response.json({ error: "Outdated tab detected. Refresh Stride before changing the Training Block; no plan records were overwritten." }, { status: 409 });
    const current = await getBundle();
    if (JSON.stringify(requestBody.basePlan) !== JSON.stringify(current.plan)) return Response.json({ error: "Training Block has changed since this tab was loaded. Refresh to protect current workouts; no data was overwritten." }, { status: 409 });
    changed.plan = requestBody.plan;
  }
  if (requestBody.preferences) changed.preferences = requestBody.preferences;
  if (requestBody.meta) changed.meta = requestBody.meta;
  const changingRuns = Array.isArray(requestBody.runs);
  if (!changingRuns && !Object.keys(changed).length) return Response.json({ error: "No changes supplied." }, { status: 400 });
  try {
    // Bulk replacements from stale browser tabs are forbidden.
    if (changingRuns) {
      if (!Array.isArray(requestBody.baseRuns)) {
        return Response.json({ error: "Outdated tab detected. Refresh to protect your Run History; nothing was overwritten." }, { status: 409 });
      }
      await updateRunHistorySafely(requestBody.baseRuns, requestBody.runs!);
    }
    if (Object.keys(changed).length) await saveBundle(changed);
    const [bundle, comments] = await Promise.all([getBundle(), getComments()]);
    return Response.json({ ...bundle, comments, user: { username: user.username, role: user.role } });
  } catch (reason) {
    if (reason instanceof RunHistoryConflictError) return Response.json({ error: reason.message }, { status: 409 });
    return Response.json({ error: "Could not save changes. No Run History bulk replacement was performed." }, { status: 500 });
  }
}
