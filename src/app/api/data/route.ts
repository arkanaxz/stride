import { currentUser } from "@/lib/auth";
import { getBundle, getComments, hasMigratedLegacyData, markLegacyDataMigrated, saveBundle } from "@/lib/database";
import type { Bundle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
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
    if (!(await hasMigratedLegacyData())) {
      const current = await getBundle();
      const fresh = !current.runs.length && !current.plan.length;
      if (fresh) {
        await saveBundle({
          runs: incoming.runs || [],
          plan: incoming.plan || [],
          meta: incoming.meta || {},
          preferences: incoming.preferences,
        });
      } else if (incoming.runs?.length || incoming.plan?.length) {
        const runs = [...current.runs];
        const seen = new Set(runs.map((run) => `${run.date}|${run.name}`));
        incoming.runs?.forEach((run) => { if (!seen.has(`${run.date}|${run.name}`)) runs.push(run); });
        const plan = incoming.plan?.length ? incoming.plan : current.plan;
        await saveBundle({ runs, plan, meta: { ...incoming.meta, ...current.meta }, preferences: incoming.preferences || current.preferences });
      }
      await markLegacyDataMigrated();
    }
    const [saved, comments] = await Promise.all([getBundle(), getComments()]);
    return Response.json({ ...saved, comments, user: { username: user.username, role: user.role } });
  }
  return Response.json({ error: "Unsupported request." }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const bundle = await request.json() as Bundle;
  const [saved, comments] = await Promise.all([saveBundle(bundle), getComments()]);
  return Response.json({ ...saved, comments, user: { username: user.username, role: user.role } });
}
