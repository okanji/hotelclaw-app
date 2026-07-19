import "server-only";
/**
 * At-rest encryption for property brain OAuth client secrets — same
 * AES-256-GCM scheme as lib/chatbots/crypto.ts with a brain-specific key
 * derivation context. KEEP the derivation in sync with
 * apps/agent/agent/lib/brain-crypto.ts (the eve runtime decrypts the same
 * rows and cannot import this module — eve snapshots its agent root).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) {
    throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  }
  return createHash("sha256").update(`${secret}:property-brains`).digest();
}

export function encryptBrainSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

/** Returns null on any tampering/format mismatch rather than throwing. */
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
