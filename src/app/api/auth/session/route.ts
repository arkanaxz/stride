import { currentUser } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  return Response.json({ username: user.username, role: user.role });
}
