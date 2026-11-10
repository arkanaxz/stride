import { currentUser } from "@/lib/auth";
import { exportRecoveryPoint } from "@/lib/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Admin access required." }, { status: 403 });
  const { key } = await params;
  const backup = await exportRecoveryPoint(key);
  if (!backup) return Response.json({ error: "Recovery point not found." }, { status: 404 });
  return new Response(JSON.stringify(backup, null, 2), { headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": 'attachment; filename="stride-recovery-' + key + '.json"',
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }});
}
