import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, createSession, isLoginConfigured } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!isLoginConfigured()) return Response.json({ error: "Login is not configured by the app owner yet." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const user = await authenticateCredentials(body.username || "", body.password || "");
  if (!user) {
    return Response.json({ error: "The username or password is incorrect." }, { status: 401 });
  }
  const session = createSession(user);
  const response = NextResponse.json({ ok: true, user: { username: user.username, role: user.role } });
  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
