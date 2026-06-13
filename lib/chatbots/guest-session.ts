import "server-only";
/**
 * Guest session tokens for the public chatbot API.
 *
 * Guests are anonymous — no Supabase auth. A session token is an HMAC-signed
 * statement "this browser owns conversation X on chatbot Y", minted when the
 * conversation is created and sent as a Bearer token on every call (stored
 * in localStorage client-side: QR-launched in-app browsers and future iframe
 * embeds make cookies unreliable). Same HMAC discipline as the Stream
 * webhook signature check.
 *
 * Secret: CHATBOT_SESSION_SECRET, falling back to STREAM_API_SECRET so dev
 * environments work without new env. Tokens don't expire — a conversation
 * is the scope, and conversations are per-bot per-browser.
 */
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!s) throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function mintGuestSession(args: {
  conversationId: string;
  chatbotId: string;
}): string {
  const payload = `${args.conversationId}.${args.chatbotId}`;
  return `${payload}.${sign(payload)}`;
}

export type GuestSession = { conversationId: string; chatbotId: string };

/** Verify a Bearer token; returns null on any mismatch (never throws). */
export function verifyGuestSession(token: string | null): GuestSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [conversationId, chatbotId, mac] = parts;
  try {
    const expected = sign(`${conversationId}.${chatbotId}`);
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return { conversationId, chatbotId };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}
