import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { currentUser, registerViewer } from "@/lib/auth";
import { deleteAccount, deleteSecret, getBundle, getSecret, listAccounts, saveBundle, setSecret } from "@/lib/database";
import type { Preferences } from "@/lib/types";

const providers = ["openai", "gemini", "anthropic"] as const;
function encryptionKey() {
  const secret = process.env.STRIDE_SESSION_SECRET;
  if (!secret) throw new Error("STRIDE_SESSION_SECRET is not configured.");
  return createHash("sha256").update(secret).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export async function GET() {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const [accounts, keys, bundle] = await Promise.all([listAccounts(), Promise.all(providers.map((provider) => getSecret(`api-key:${provider}`))), getBundle()]);
  let mileage: Record<string, number> = {};
  try { mileage = JSON.parse(String(bundle.meta.shoeMileageBase || "{}")) as Record<string, number>; } catch { /* empty saved baseline */ }
  return Response.json({ accounts, savedKeys: Object.fromEntries(providers.map((provider, index) => [provider, Boolean(keys[index])])), shoeMileageBase: mileage, provider: bundle.preferences.provider, model: bundle.preferences.model, preferences: bundle.preferences });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { action?: string; username?: string; password?: string; id?: string; provider?: string; apiKey?: string; mileage?: Record<string, number>; preferences?: Preferences };
  try {
    if (body.action === "create-account") {
      const username = body.username?.trim() || "";
      if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username) || !body.password || body.password.length < 12) return Response.json({ error: "Use a 3–32 character username and a password of at least 12 characters." }, { status: 400 });
      await registerViewer(username, body.password);
      return Response.json({ accounts: await listAccounts() });
    }
    if (body.action === "delete-account") {
      if (!body.id) return Response.json({ error: "Choose an account to remove." }, { status: 400 });
      await deleteAccount(body.id);
      return Response.json({ accounts: await listAccounts() });
    }
    if (body.action === "save-api-key") {
      if (!providers.includes(body.provider as typeof providers[number]) || !body.apiKey?.trim()) return Response.json({ error: "Choose a provider and enter an API key." }, { status: 400 });
      await setSecret(`api-key:${body.provider}`, encrypt(body.apiKey.trim()));
      return Response.json({ saved: true });
    }
    if (body.action === "delete-api-key") {
      if (!providers.includes(body.provider as typeof providers[number])) return Response.json({ error: "Choose a valid provider." }, { status: 400 });
      await deleteSecret(`api-key:${body.provider}`);
      return Response.json({ saved: false });
    }
    if (body.action === "save-mileage") {
      const current = await getBundle();
      const safe = Object.fromEntries(Object.entries(body.mileage || {}).map(([shoe, value]) => [shoe, Math.max(0, Number(value) || 0)]));
      await saveBundle({ meta: { ...current.meta, shoeMileageBase: JSON.stringify(safe) } });
      return Response.json({ saved: true });
    }
    if (body.action === "save-preferences" && body.preferences) {
      const current = await getBundle();
      await saveBundle({ preferences: { ...current.preferences, ...body.preferences } });
      return Response.json({ saved: true });
    }
  } catch (error) {
    const message = error instanceof Error && /unique|constraint/i.test(error.message) ? "That username already exists." : "Could not save the admin change.";
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ error: "Unsupported admin action." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (user?.role !== "admin") return Response.json({ error: "Administrator access required." }, { status: 403 });
  const provider = new URL(request.url).searchParams.get("provider") || "";
  if (!providers.includes(provider as typeof providers[number])) return Response.json({ error: "Choose a valid provider." }, { status: 400 });
  await deleteSecret(`api-key:${provider}`);
  return Response.json({ saved: false });
}
