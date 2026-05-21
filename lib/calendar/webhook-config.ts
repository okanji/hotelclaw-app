import "server-only";

/**
 * Webhook configuration for the calendar push integrations. The webhook
 * endpoints have to be publicly reachable for Google/Microsoft to deliver
 * notifications — there's no way around that on the provider side.
 *
 * Locally that means running `ngrok` and setting `CALENDAR_WEBHOOK_BASE`
 * (e.g. `https://abcd.ngrok.app`). In production it's just the deployed
 * host. When the env var isn't set, callers should *skip* wiring up
 * push — falling back to the focus-poll + manual refresh keeps the rest
 * of the calendar usable without webhook plumbing.
 */
export function webhookBase(): string | null {
  return process.env.CALENDAR_WEBHOOK_BASE ?? null;
}

export function googleWebhookUrl(): string | null {
  const base = webhookBase();
  return base ? `${base.replace(/\/$/, "")}/api/calendar/google/webhook` : null;
}

export function microsoftWebhookUrl(): string | null {
  const base = webhookBase();
  return base
    ? `${base.replace(/\/$/, "")}/api/calendar/microsoft/webhook`
    : null;
}

/** Shared secret a cron service can pass to hit /renew-subscriptions. */
export function renewalSecret(): string | null {
  return process.env.CALENDAR_RENEWAL_SECRET ?? null;
}
