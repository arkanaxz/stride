import { currentUser } from "@/lib/auth";
import { addComment, getBundle, getComments, removeComment } from "@/lib/database";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const runId = Number(new URL(request.url).searchParams.get("runId"));
  return Response.json((await getComments()).filter((comment) => comment.runId === runId));
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { runId?: number; text?: string };
  const text = body.text?.trim() || "";
  const bundle = await getBundle();
  if (!Number.isInteger(body.runId) || !bundle.runs.some((run) => run.id === body.runId)) return Response.json({ error: "Choose a run to comment on." }, { status: 400 });
  if (!text || text.length > 2000) return Response.json({ error: "Comments must be 1–2,000 characters." }, { status: 400 });
  await addComment(body.runId!, user.username, text);
  return Response.json((await getComments()).filter((comment) => comment.runId === body.runId));
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  if (!Number.isInteger(body.id)) return Response.json({ error: "Choose a comment to remove." }, { status: 400 });
  await removeComment(body.id!, user.username, user.role === "admin");
  return Response.json({ ok: true });
}
