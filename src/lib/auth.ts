import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "stride_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function signature(expires: string) {
  const secret = process.env.STRIDE_SESSION_SECRET;
  if (!secret) throw new Error("STRIDE_SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(expires).digest("hex");
}

export function isLoginConfigured() {
  return Boolean(process.env.STRIDE_USERNAME && process.env.STRIDE_PASSWORD && process.env.STRIDE_SESSION_SECRET);
}

export function validateCredentials(username: string, password: string) {
  const expectedUsername = process.env.STRIDE_USERNAME || "";
  const expectedPassword = process.env.STRIDE_PASSWORD || "";
  if (!expectedUsername || !expectedPassword || !process.env.STRIDE_SESSION_SECRET) return false;
  const usernameHash = createHmac("sha256", "stride-login").update(username).digest();
  const expectedUsernameHash = createHmac("sha256", "stride-login").update(expectedUsername).digest();
  const passwordHash = createHmac("sha256", "stride-login").update(password).digest();
  const expectedPasswordHash = createHmac("sha256", "stride-login").update(expectedPassword).digest();
  return timingSafeEqual(usernameHash, expectedUsernameHash) && timingSafeEqual(passwordHash, expectedPasswordHash);
}

export function createSession() {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return { value: `${expires}.${signature(expires)}`, maxAge: SESSION_SECONDS };
}

export function verifySession(value?: string) {
  if (!value) return false;
  const [expires, suppliedSignature, ...rest] = value.split(".");
  if (!expires || !suppliedSignature || rest.length || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  try {
    const expected = Buffer.from(signature(expires), "hex");
    const supplied = Buffer.from(suppliedSignature, "hex");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch {
    return false;
  }
}
