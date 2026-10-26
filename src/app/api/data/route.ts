import { getBundle, hasMigratedLegacyData, markLegacyDataMigrated, saveBundle } from "@/lib/database";
import type { Bundle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getBundle(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
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
    return Response.json(await getBundle());
  }
  return Response.json({ error: "Unsupported request." }, { status: 400 });
}

export async function PUT(request: Request) {
  const bundle = await request.json() as Bundle;
  return Response.json(await saveBundle(bundle));
}
