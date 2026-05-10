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
 * Sender used until we verify a hotelclaw.com domain in Resend.
 * `onboarding@resend.dev` is Resend's shared sender — works without domain
 * verification but will land in spam more often than a verified sender.
 *
 * To switch to a verified domain: add it in Resend dashboard, prove ownership
 * via DNS records, then change this constant to e.g. `Hotelclaw <invites@hotelclaw.com>`.
 */
export const DEFAULT_FROM = "Hotelclaw <onboarding@resend.dev>";
