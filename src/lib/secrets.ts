import { createDecipheriv, createHash } from "node:crypto";
import { getSecret } from "@/lib/database";

function encryptionKey() {
  const secret = process.env.STRIDE_SESSION_SECRET;
  if (!secret) throw new Error("STRIDE_SESSION_SECRET is not configured.");
  return createHash("sha256").update(secret).digest();
}

export async function getProviderKey(provider: string) {
  const stored = await getSecret(`api-key:${provider}`);
  if (!stored) return "";
  const [iv, tag, data] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
