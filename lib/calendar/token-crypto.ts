import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-layer encryption for OAuth tokens stored in `calendar_connections`.
 *
 * RLS already keeps tokens scoped to their owning user, but a stolen DB
 * dump (backup leak, accidental SELECT in a debug session) would otherwise
 * surface them in plaintext. AES-256-GCM with a 12-byte nonce gives us
 * confidentiality + integrity in ~80 bytes of overhead per token.
 *
 * Format on disk: `enc:v1:<base64-nonce>:<base64-ciphertext-with-tag>`
 *
 * The "enc:v1:" sentinel lets us tell ciphertext from a legacy plaintext
 * token (or a token written when the key wasn't configured) and gracefully
 * fall through to returning the raw value. So a deploy that flips the env
 * var on can keep reading old plaintext rows; they get re-encrypted on the
 * next token refresh.
 *
 * Key handling:
 *   * `CALENDAR_TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte key. Generate
 *     once with `openssl rand -base64 32` and stash in `.env.local`.
 *   * If unset, we log a single warning at module load and short-circuit
 *     to plaintext for both encrypt and decrypt — local dev still works.
 */

const SENTINEL = "enc:v1:";
const KEY_VAR = "CALENDAR_TOKEN_ENCRYPTION_KEY";
const ALG = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let warned = false;

function getKey(): Buffer | null {
  const raw = process.env[KEY_VAR];
  if (!raw) {
    if (!warned) {
      console.warn(
        `[calendar] ${KEY_VAR} is not set — OAuth tokens will be stored in plaintext`,
      );
      warned = true;
    }
    return null;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    if (!warned) {
      console.warn(
        `[calendar] ${KEY_VAR} must decode to 32 bytes (got ${key.length}); falling back to plaintext`,
      );
      warned = true;
    }
    return null;
  }
  return key;
}

/** Encrypt a token; returns the same string verbatim when no key is configured. */
export function encryptToken(plain: string): string {
  const key = getKey();
  if (!key) return plain;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALG, key, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // ciphertext || tag — concatenated so the decryption side can split with a
  // fixed-length tag without bookkeeping.
  const payload = Buffer.concat([enc, tag]).toString("base64");
  return `${SENTINEL}${nonce.toString("base64")}:${payload}`;
}

/**
 * Decrypt a token. Plain values (no sentinel) and the empty string are
 * returned as-is so legacy plaintext rows + the `null` case keep working.
 */
export function decryptToken(stored: string | null): string {
  if (!stored) return "";
  if (!stored.startsWith(SENTINEL)) return stored;
  const key = getKey();
  if (!key) {
    // Sentinel says encrypted but no key — caller can't do anything useful.
    throw new Error(
      `Cannot decrypt: ${KEY_VAR} is not set but a sentinel-tagged ciphertext is present`,
    );
  }
  const [, , nonceB64, payloadB64] = stored.split(":");
  if (!nonceB64 || !payloadB64) {
    throw new Error("Malformed encrypted token");
  }
  const nonce = Buffer.from(nonceB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  if (payload.length < TAG_BYTES) {
    throw new Error("Encrypted token payload too short");
  }
  const ciphertext = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = createDecipheriv(ALG, key, nonce);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return out.toString("utf8");
}
