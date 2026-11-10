import { currentUser } from "@/lib/auth";
import { createRecoveryPoint, listRecoveryPoints } from "@/lib/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  return Response.json({ points: await listRecoveryPoints() }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST() {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  try {
    const backup = await createRecoveryPoint("Manual backup");
    return Response.json({ backup }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not create or verify the backup. No recovery point was reported as saved." }, { status: 500 });
  }
}
