import "server-only";
import { Resend } from "resend";

let _client: Resend | null = null;

export function getResend(): Resend {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY is not set");
  }
  _client = new Resend(key);
  return _client;
}

/**
 * Sender for all outbound email (invites, bookings, insight digests).
 *
 * `onboarding@resend.dev` is Resend's shared sender — it works without domain
 * verification BUT only delivers to the Resend account owner's own address;
 * every other recipient gets a 403 `validation_error`. That's why real invites
 * fail until a domain is verified.
 *
 * To go live: add a domain at resend.com/domains, prove ownership via its DNS
 * records, then set `EMAIL_FROM` (Vercel env + .env.local) to e.g.
 * `Hotelclaw <invites@hotelclaw.com>` — no code change or redeploy needed.
 */
export const DEFAULT_FROM =
  process.env.EMAIL_FROM?.trim() || "Hotelclaw <onboarding@resend.dev>";
