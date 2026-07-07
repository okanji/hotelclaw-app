import "server-only";
import { createClient as createBrowserSupabase } from "@supabase/supabase-js";
import {
  watchEvents,
  stopGoogleWatch,
  type GoogleCalendarListEntry,
} from "./google";
import {
  createSubscription,
  renewSubscription,
  stopMicrosoftSubscription,
} from "./microsoft";
import {
  googleWebhookUrl,
  microsoftWebhookUrl,
} from "./webhook-config";
import { decryptToken } from "./token-crypto";
import type { Database } from "@/lib/db/types";

type ServiceClient = ReturnType<
  typeof createBrowserSupabase<Database>
>;

/**
 * Open or re-open push delivery for a connection. Best-effort: any failure
 * just leaves the connection without push (focus-poll + manual refresh
 * still work). Stashes the channel details in `push_subscription` jsonb
 * and the expiry in `push_expires_at` so the renewal cron can find rows.
 *
 * Picking which primary calendar to watch for Google is straightforward —
 * we use the calendar marked `is_primary`. Microsoft subscriptions are
 * mailbox-level so there's no per-calendar choice.
 */
export async function ensureGooglePushForConnection(
  supabase: ServiceClient,
  connection: {
    id: string;
    access_token: string;
    push_subscription: Record<string, unknown> | null;
  },
  primaryCalendarExternalId: string | null,
): Promise<void> {
  const url = googleWebhookUrl();
  if (!url || !primaryCalendarExternalId) return;

  // Stop any prior channel for this connection before opening a new one.
  if (connection.push_subscription) {
    try {
      await stopGoogleWatch(
        decryptToken(connection.access_token),
        connection.push_subscription,
      );
    } catch {
      // Already gone or expired — ignore.
    }
  }

  const channelId = crypto.randomUUID();
  const token = crypto.randomUUID();
  try {
    const channel = await watchEvents(
      decryptToken(connection.access_token),
      primaryCalendarExternalId,
      {
        channelId,
        address: url,
        token,
        // 604800s = 7 days, Google's max for events.watch.
        ttlSeconds: 604_800,
      },
    );
    await supabase
      .from("calendar_connections")
      .update({
        push_subscription: {
          channelId: channel.id,
          resourceId: channel.resourceId,
          token,
          calendarExternalId: primaryCalendarExternalId,
        },
        push_expires_at: new Date(
          Number(channel.expiration),
        ).toISOString(),
      })
      .eq("id", connection.id);
  } catch (err) {
    // Push setup failure is non-fatal: surface in the sidebar via
    // `last_sync_error` but keep the connection alive.
    await supabase
      .from("calendar_connections")
      .update({
        last_sync_error: `Push setup failed: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      })
      .eq("id", connection.id);
  }
}

export async function ensureMicrosoftPushForConnection(
  supabase: ServiceClient,
  connection: {
    id: string;
    access_token: string;
    push_subscription: Record<string, unknown> | null;
  },
): Promise<void> {
  const url = microsoftWebhookUrl();
  if (!url) return;

  if (connection.push_subscription) {
    try {
      await stopMicrosoftSubscription(
        decryptToken(connection.access_token),
        connection.push_subscription,
      );
    } catch {
      // Already gone — ignore.
    }
  }

  const clientState = crypto.randomUUID();
  // Graph caps calendar subscriptions at 4230 minutes ≈ 70.5h. Pick 3d so
  // the renew cron has slack — running daily would still touch every row
  // before expiry, but a 24h scheduling gap doesn't lose us push delivery.
  const expirationDateTime = new Date(
    Date.now() + 3 * 24 * 60 * 60_000,
  ).toISOString();
  try {
    const sub = await createSubscription(
      decryptToken(connection.access_token),
      {
        notificationUrl: url,
        clientState,
        expirationDateTime,
      },
    );
    await supabase
      .from("calendar_connections")
      .update({
        push_subscription: {
          subscriptionId: sub.id,
          clientState,
        },
        push_expires_at: sub.expirationDateTime,
      })
      .eq("id", connection.id);
  } catch (err) {
    await supabase
      .from("calendar_connections")
      .update({
        last_sync_error: `Push setup failed: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      })
      .eq("id", connection.id);
  }
}

/**
 * Pick which Google calendar to watch. Graph subscriptions are
 * mailbox-wide so this doesn't apply there. For Google we watch the
 * `primary` calendar; per-non-primary calendar push would mean N more
 * channels per user, which isn't worth it for v1.
 */
export function primaryGoogleCalendar(
  calendars: GoogleCalendarListEntry[],
): GoogleCalendarListEntry | null {
  return calendars.find((c) => c.primary) ?? calendars[0] ?? null;
}
