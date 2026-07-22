/**
 * Decrypt property_brains client secrets. The AES-256-GCM scheme + key
 * derivation live in @hotelclaw/brain — shared with apps/web, so the two
 * runtimes can no longer drift.
 */
import { decryptBrainSecretWith } from "@hotelclaw/brain";

function secretMaterial(): string {
  const secret =
    process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!secret) throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  return secret;
}

export function decryptBrainSecret(ciphertext: string): string | null {
  return decryptBrainSecretWith(secretMaterial(), ciphertext);
}
