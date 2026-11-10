import { currentUser } from "@/lib/auth";
import { restoreFuturePlanFromRecoveryPoint, RunHistoryConflictError } from "@/lib/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { key?: string; confirm?: string };
  if (body.confirm !== "RESTORE PLAN" || !body.key) {
    return Response.json({ error: "Select a recovery point and type RESTORE PLAN to confirm." }, { status: 400 });
  }
  try {
    const result = await restoreFuturePlanFromRecoveryPoint(body.key);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RunHistoryConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Restore could not be confirmed; refresh and verify the plan before retrying." }, { status: 500 });
  }
}
