/**
 * Decrypt property_brains client secrets (AES-256-GCM). MIRROR of
 * apps/web/lib/brain/crypto.ts (key context "property-brains") — keep the
 * derivation in sync; this runtime can't import web modules (eve snapshots
 * only the agent root).
 */
import { createDecipheriv, createHash } from "node:crypto";

function key(): Buffer {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  return createHash("sha256").update(`${secret}:property-brains`).digest();
}

export function decryptBrainSecret(ciphertext: string): string | null {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
