import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/calendar/token-crypto";
import {
  listEvents,
  normaliseEventTimes,
  refreshAccessToken,
} from "@/lib/calendar/google";

/**
 * `POST /api/calendar/google/webhook`
 *
 * Google delivers a notification with these headers:
 *   X-Goog-Channel-ID         — the id we set on watch (uuid)
 *   X-Goog-Channel-Token      — the per-channel secret we set on watch
 *   X-Goog-Resource-ID        — opaque id for the watched resource
 *   X-Goog-Resource-State     — "sync" (initial) | "exists" | "not_exists"
 *   X-Goog-Channel-Expiration — RFC1123 expiry
 *
 * Body is empty; the headers are the payload. On any state we just nudge
 * the connection's sync to run. The first "sync" message after watch()
 * is an initial sync confirmation — we still kick a sync because it's
 * cheap (Google returns no events when there are none).
 *
 * Uses the service-role client because Google's POST has no session.
 * We re-authenticate the request via `X-Goog-Channel-Token`, which we
 * generated per-channel and stored encrypted in `push_subscription`.
 */
export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const channelToken = request.headers.get("x-goog-channel-token");
  const resourceState = request.headers.get("x-goog-resource-state");
  if (!channelId || !channelToken) {
    return NextResponse.json(
      { error: "missing google channel headers" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { data: cal } = await supabase
    .from("external_calendars")
    .select(
      `id, sync_token, connection:calendar_connections!inner(
         id, user_id, provider,
         access_token, refresh_token, expires_at,
         push_subscription
       )`,
    )
    .filter(
      "connection.push_subscription->>channelId",
      "eq",
      channelId,
    )
    .maybeSingle();

  if (!cal) return NextResponse.json({ ok: true }); // Stale channel: ignore.
  const conn = (cal.connection as unknown) as {
    id: string;
    user_id: string;
    provider: "google" | "microsoft";
    access_token: string;
    refresh_token: string | null;
    expires_at: string | null;
    push_subscription: { channelId: string; token: string } | null;
  };
  if (conn.push_subscription?.token !== channelToken) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
  if (conn.provider !== "google") return NextResponse.json({ ok: true });

  // `sync` is the first notification after watch() and has no event
  // changes to report — skip the API roundtrip.
  if (resourceState === "sync") return NextResponse.json({ ok: true });

  await syncCalendar(supabase, conn, cal.id, cal.sync_token);
  return NextResponse.json({ ok: true });
}

async function syncCalendar(
  supabase: ReturnType<typeof createServiceClient>,
  conn: {
    id: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: string | null;
  },
  calId: string,
  syncToken: string | null,
) {
  let accessToken = decryptToken(conn.access_token);
  if (
    conn.expires_at &&
    new Date(conn.expires_at).getTime() - Date.now() < 60_000 &&
    conn.refresh_token
  ) {
    const refreshed = await refreshAccessToken(
      decryptToken(conn.refresh_token),
    );
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

  const { data: cal } = await supabase
    .from("external_calendars")
    .select("external_id")
    .eq("id", calId)
    .single();
  if (!cal) return;

  const result = await listEvents(accessToken, cal.external_id, {
    syncToken,
  });
  if (result.fullSyncRequired) {
    await supabase.from("external_events").delete().eq("calendar_id", calId);
    return;
  }
  const upserts = result.events
    .filter((e) => e.status !== "cancelled" && e.start && e.end)
    .map((e) => {
      const times = normaliseEventTimes(e);
      return {
        calendar_id: calId,
        external_id: e.id,
        title: e.summary ?? "(no title)",
        description: e.description ?? null,
        location: e.location ?? null,
        start_at: times.start,
        end_at: times.end,
        all_day: times.all_day,
        etag: e.etag ?? null,
        status: e.status,
        busy_status: (e.transparency === "transparent" ? "free" : "busy") as
          | "free"
          | "busy",
        html_link: e.htmlLink ?? null,
        organizer_email: e.organizer?.email ?? null,
        organizer_name: e.organizer?.displayName ?? null,
      };
    });
  const cancelled = result.events
    .filter((e) => e.status === "cancelled")
    .map((e) => e.id);
  if (upserts.length > 0) {
    await supabase
      .from("external_events")
      .upsert(upserts, { onConflict: "calendar_id,external_id" });
  }
  if (cancelled.length > 0) {
    await supabase
      .from("external_events")
      .delete()
      .eq("calendar_id", calId)
      .in("external_id", cancelled);
  }
  if (result.nextSyncToken) {
    await supabase
      .from("external_calendars")
      .update({ sync_token: result.nextSyncToken })
      .eq("id", calId);
  }
  await supabase
    .from("calendar_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq("id", conn.id);
}
