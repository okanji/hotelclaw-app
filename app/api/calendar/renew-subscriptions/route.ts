import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { renewSubscription } from "@/lib/calendar/microsoft";
import { decryptToken, encryptToken } from "@/lib/calendar/token-crypto";
import {
  ensureGooglePushForConnection,
  ensureMicrosoftPushForConnection,
} from "@/lib/calendar/push";
import { refreshAccessToken as refreshGoogle } from "@/lib/calendar/google";
import { refreshAccessToken as refreshMicrosoft } from "@/lib/calendar/microsoft";
import { renewalSecret } from "@/lib/calendar/webhook-config";

/**
 * `POST /api/calendar/renew-subscriptions`
 *
 * Cron-triggered: finds connections whose push channels expire within the
 * next 24 hours and renews them. Google's `events.watch` can't be
 * extended in place — we have to open a new channel and let the old one
 * lapse — so the helper deletes-then-recreates. Microsoft has a PATCH so
 * we update the expirationDateTime in place.
 *
 * Auth: the request must carry `Authorization: Bearer <CALENDAR_RENEWAL_SECRET>`.
 * No session — the runner is a cron service (Vercel Cron, GitHub Actions,
 * Supabase pg_cron).
 */
export async function POST(request: Request) {
  const secret = renewalSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "CALENDAR_RENEWAL_SECRET not configured" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const horizon = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const { data: connections } = await supabase
    .from("calendar_connections")
    .select(
      "id, provider, access_token, refresh_token, expires_at, push_subscription",
    )
    .lt("push_expires_at", horizon);

  let renewed = 0;
  let failed = 0;
  for (const conn of connections ?? []) {
    try {
      let accessToken = decryptToken(conn.access_token);
      if (
        conn.expires_at &&
        new Date(conn.expires_at).getTime() - Date.now() < 60_000 &&
        conn.refresh_token
      ) {
        const refresh =
          conn.provider === "google" ? refreshGoogle : refreshMicrosoft;
        const refreshed = await refresh(decryptToken(conn.refresh_token));
        accessToken = refreshed.access_token;
        await supabase
          .from("calendar_connections")
          .update({
            access_token: encryptToken(accessToken),
            expires_at: new Date(
              Date.now() + refreshed.expires_in * 1000,
            ).toISOString(),
          })
          .eq("id", conn.id);
      }

      if (conn.provider === "microsoft") {
        const sub = conn.push_subscription as
          | { subscriptionId: string }
          | null;
        if (!sub) {
          await ensureMicrosoftPushForConnection(supabase, {
            id: conn.id,
            access_token: encryptToken(accessToken),
            push_subscription: null,
          });
        } else {
          const newExp = new Date(
            Date.now() + 3 * 24 * 60 * 60_000,
          ).toISOString();
          await renewSubscription(accessToken, sub.subscriptionId, newExp);
          await supabase
            .from("calendar_connections")
            .update({ push_expires_at: newExp })
            .eq("id", conn.id);
        }
      } else {
        // Google: tear down + reopen. The push helper handles both.
        const sub = conn.push_subscription as {
          calendarExternalId?: string;
        } | null;
        await ensureGooglePushForConnection(
          supabase,
          {
            id: conn.id,
            access_token: encryptToken(accessToken),
            push_subscription:
              (conn.push_subscription as Record<string, unknown>) ?? null,
          },
          sub?.calendarExternalId ?? null,
        );
      }
      renewed++;
    } catch (e) {
      failed++;
      await supabase
        .from("calendar_connections")
        .update({
          last_sync_error: `Renew failed: ${
            e instanceof Error ? e.message : "unknown"
          }`,
        })
        .eq("id", conn.id);
    }
  }

  return NextResponse.json({ ok: true, renewed, failed });
}
