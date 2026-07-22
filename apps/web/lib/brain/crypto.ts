import "server-only";
/**
 * At-rest encryption for property brain OAuth client secrets. The actual
 * AES-256-GCM scheme + key derivation live in @hotelclaw/brain (shared
 * with the eve runtime, which decrypts the same rows); this module only
 * binds them to the app's env secret.
 */
import { decryptBrainSecretWith, encryptBrainSecretWith } from "@hotelclaw/brain";

function secretMaterial(): string {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) {
    throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  }
  return secret;
}

export function encryptBrainSecret(plaintext: string): string {
  return encryptBrainSecretWith(secretMaterial(), plaintext);
}

/** Returns null on any tampering/format mismatch rather than throwing. */
export function decryptBrainSecret(ciphertext: string): string | null {
  return decryptBrainSecretWith(secretMaterial(), ciphertext);
}
