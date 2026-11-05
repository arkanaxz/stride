import { currentUser } from "@/lib/auth";
import { ensureAuthoritativeWorkbookPlan, ensureVerifiedGarminRunRecovery, getBundle, getComments, saveBundle, updateRunHistorySafely, RunHistoryConflictError } from "@/lib/database";
import type { Bundle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  await ensureAuthoritativeWorkbookPlan();
  await ensureVerifiedGarminRunRecovery();
  const [bundle, comments] = await Promise.all([getBundle(), getComments()]);
  let shoeMileageBase: Record<string, number> = {};
  try { shoeMileageBase = JSON.parse(String(bundle.meta.shoeMileageBase || "{}")) as Record<string, number>; } catch { /* no baseline saved */ }
  return Response.json({ ...bundle, comments, shoeMileageBase, user: { username: user.username, role: user.role } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const incoming = await request.json() as Partial<Bundle> & { kind?: string };
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
  const requestBody = await request.json() as Partial<Bundle> & { baseRuns?: Bundle["runs"] };
  const changed: Partial<Bundle> = {};
  if (Array.isArray(requestBody.plan)) changed.plan = requestBody.plan;
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
