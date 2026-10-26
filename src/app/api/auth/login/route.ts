import { NextRequest, NextResponse } from "next/server";
import { createSession, isLoginConfigured, SESSION_COOKIE, validateCredentials } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!isLoginConfigured()) return Response.json({ error: "Login is not configured by the app owner yet." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  if (!validateCredentials(body.username || "", body.password || "")) {
    return Response.json({ error: "The username or password is incorrect." }, { status: 401 });
  }
  const session = createSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
