/**
 * Decrypt-only mirror for custom-action header secrets. KEEP THE DERIVATION
 * IN SYNC with apps/web/lib/chatbots/crypto.ts (context string
 * "chatbot-custom-actions") — the web app encrypts, this runtime decrypts
 * the same rows and cannot import web modules (eve snapshots its agent
 * root). NOT the same context as brain-crypto.ts (":property-brains").
 */
import { createDecipheriv, createHash } from "node:crypto";

function key(): Buffer {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) {
    throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  }
  return createHash("sha256")
    .update(`${secret}:chatbot-custom-actions`)
    .digest();
}

/** Returns null on any tampering/format mismatch rather than throwing. */
export function decryptActionSecret(ciphertext: string): string | null {
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
