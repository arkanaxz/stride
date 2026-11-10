import { currentUser } from "@/lib/auth";
import { exportPre34WeekSnapshot } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the complete database snapshot captured immediately before the 34-week import. */
export async function GET() {
  const user = await currentUser();
  if (user?.role !== "admin") {
    return Response.json({ error: "Administrator login required for backup export." }, { status: 403 });
  }
  const snapshot = await exportPre34WeekSnapshot();
  if (!snapshot) {
    return Response.json({ error: "The 34-week pre-import snapshot is not available yet. Refresh the dashboard first." }, { status: 404 });
  }
  return new Response(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"stride-pre34week-backup-2026-11-10.json\"",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
