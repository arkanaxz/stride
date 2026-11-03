import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE, signSession, verifySession, type UserSession } from "@/lib/session";

const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function isLoginConfigured() {
  return Boolean(process.env.STRIDE_USERNAME && process.env.STRIDE_PASSWORD && process.env.STRIDE_SESSION_SECRET);
}

export async function authenticateCredentials(username: string, password: string): Promise<UserSession | null> {
  const configuredUser = process.env.STRIDE_USERNAME || "";
  if (configuredUser && username.toLowerCase() === configuredUser.toLowerCase() && password === process.env.STRIDE_PASSWORD && process.env.STRIDE_SESSION_SECRET) {
    return { username: configuredUser, role: "admin", expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS };
  }
  const { getStoredAccount } = await import("@/lib/database");
  const account = await getStoredAccount(username);
  if (!account || !process.env.STRIDE_SESSION_SECRET) return null;
  const supplied = scryptSync(password, account.salt, 64);
  const expected = Buffer.from(account.password_hash, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { username: account.username, role: "viewer", expires: Math.floor(Date.now() / 1000) + SESSION_SECONDS };
}

export function createSession(user: UserSession) {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return { value: `${payload}.${signSession(payload)}`, maxAge: SESSION_SECONDS };
}

export async function currentUser(): Promise<UserSession | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

export async function registerViewer(username: string, password: string) {
  const { salt, hash } = hashPassword(password);
  const { createAccount } = await import("@/lib/database");
  await createAccount(randomBytes(16).toString("hex"), username, salt, hash);
}
