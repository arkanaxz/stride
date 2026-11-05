import { currentUser } from "@/lib/auth";
import { ensureAuthoritativeWorkbookPlan, getBundle, getComments, saveBundle } from "@/lib/database";
import type { Bundle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  await ensureAuthoritativeWorkbookPlan();
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
  const requestBody = await request.json() as Partial<Bundle>;
  // Only update explicitly supplied sections, not stale copies of the other tables.
  const changed: Partial<Bundle> = {};
  if (Array.isArray(requestBody.runs)) changed.runs = requestBody.runs;
  if (Array.isArray(requestBody.plan)) changed.plan = requestBody.plan;
  if (requestBody.preferences) changed.preferences = requestBody.preferences;
  if (requestBody.meta) changed.meta = requestBody.meta;
  if (!Object.keys(changed).length) return Response.json({ error: "No changes supplied." }, { status: 400 });
  const [saved, comments] = await Promise.all([saveBundle(changed), getComments()]);
  return Response.json({ ...saved, comments, user: { username: user.username, role: user.role } });
}
