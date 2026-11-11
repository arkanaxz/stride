import { currentUser } from "@/lib/auth";
import { getComments, saveStrengthWorkoutLog, RunHistoryConflictError } from "@/lib/database";
import type { StrengthLog } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") {
    return Response.json({ error: "Administrator access required." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as { workoutId?: string | number; log?: StrengthLog };
  try {
    const bundle = await saveStrengthWorkoutLog(String(body.workoutId || ""), body.log!);
    const comments = await getComments();
    let shoeMileageBase: Record<string, number> = {};
    try { shoeMileageBase = JSON.parse(String(bundle.meta.shoeMileageBase || "{}")) as Record<string, number>; } catch { /* existing mileage baseline unchanged */ }
    return Response.json({
      ...bundle, comments, shoeMileageBase,
      user: { username: user.username, role: user.role },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) {
    if (reason instanceof RunHistoryConflictError) {
      return Response.json({ error: reason.message }, { status: 409 });
    }
    const reference = crypto.randomUUID().slice(0, 8);
    console.error("[Stride strength-log]", reference, reason instanceof Error ? reason.message : "Unknown error");
    return Response.json({ error: "Strength workout could not be saved (" + reference + "). Check the existing record before retrying." }, { status: 500 });
  }
}
