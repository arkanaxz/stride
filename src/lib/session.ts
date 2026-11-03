import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "stride_session";
export type UserSession = { username: string; role: "admin" | "viewer"; expires: number };

function signature(payload: string) {
  const secret = process.env.STRIDE_SESSION_SECRET;
  if (!secret) throw new Error("STRIDE_SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(payload: string) { return signature(payload); }

export function verifySession(value?: string): UserSession | null {
  if (!value) return null;
  const [payload, suppliedSignature, ...rest] = value.split(".");
  if (!payload || !suppliedSignature || rest.length) return null;
  try {
    const expected = Buffer.from(signature(payload));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UserSession;
    if (!user.username || !["admin", "viewer"].includes(user.role) || user.expires <= Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch { return null; }
}
