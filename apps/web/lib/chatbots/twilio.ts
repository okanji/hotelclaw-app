import "server-only";
/**
 * Minimal Twilio plumbing for the WhatsApp/SMS chatbot channel — raw
 * fetch + HMAC, no SDK dependency.
 *
 * Env (all optional — the channel is fail-soft):
 *   TWILIO_AUTH_TOKEN   — validates inbound webhook signatures AND
 *                         authenticates outbound sends
 *   TWILIO_ACCOUNT_SID  — required for outbound sends
 *
 * With only the webhook configured (no env), inbound still works and
 * replies ride the synchronous TwiML response.
 */
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Twilio request signature: base64(HMAC-SHA1(url + sorted-concat(params))).
 * Returns true when TWILIO_AUTH_TOKEN is unset (dev) — with a warning.
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    console.warn(
      "[twilio] TWILIO_AUTH_TOKEN not set — accepting webhook without signature validation",
    );
    return true;
  }
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function twilioSendConfigured(): boolean {
  return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
}

/** Outbound message via the REST API. Fail-soft: logs and returns false. */
export async function sendTwilioMessage(args: {
  to: string;
  from: string;
  body: string;
}): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return false;
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: args.to,
          From: args.from,
          Body: args.body.slice(0, 1600),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      console.error("[twilio] send failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[twilio] send threw", err);
    return false;
  }
}

export function twimlReply(message: string | null): Response {
  const escaped = (message ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
