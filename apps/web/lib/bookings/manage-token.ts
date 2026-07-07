import "server-only";
/**
 * Guest booking "magic links" — signed deep links, NOT Supabase magic
 * links. Staff sign in with Supabase OTP because they have accounts;
 * guests deliberately don't, so their manage link is an HMAC statement
 * "the bearer may view/cancel booking X" (same discipline as the chatbot
 * session tokens in lib/chatbots/guest-session.ts). Sent in the
 * confirmation email; no expiry — the booking's lifecycle is the scope.
 */
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  const s = process.env.CHATBOT_SESSION_SECRET ?? process.env.STREAM_API_SECRET;
  if (!s) throw new Error("CHATBOT_SESSION_SECRET (or STREAM_API_SECRET) must be set");
  return s;
}

function sign(bookingId: string): string {
  return createHmac("sha256", secret())
    .update(`booking-manage.${bookingId}`)
    .digest("hex")
    .slice(0, 32);
}

export function mintManageToken(bookingId: string): string {
  return `${bookingId}.${sign(bookingId)}`;
}

/** Returns the booking id, or null on any mismatch (never throws). */
export function verifyManageToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const bookingId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  try {
    const expected = sign(bookingId);
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return bookingId;
}
