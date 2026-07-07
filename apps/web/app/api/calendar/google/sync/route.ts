import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listEvents,
  normaliseEventTimes,
  refreshAccessToken,
} from "@/lib/calendar/google";
import { decryptToken, encryptToken } from "@/lib/calendar/token-crypto";

/**
 * `POST /api/calendar/google/sync?connectionId=<id>`
 *
 * Pulls the connection's calendar list incrementally (using the per-
 * calendar `sync_token`) and mirrors into `external_events`. Idempotent:
 * Google's `syncToken` ensures we only pull what's changed since the last
 * call, and our upsert is keyed on `(calendar_id, external_id)`.
 *
 * Triggered:
 *   * Inline from the OAuth callback (first sync)
 *   * From the sidebar via "Reconnect" / "Refresh now"
 *   * (Later) from a Google Push Notifications webhook
 *
 * Falls back to a 60-day window on the first sync or when Google rejects
 * a stale sync token (410 Gone).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId is required" },
      { status: 400 },
    );
  }

  const { data: connection, error: connErr } = await supabase
    .from("calendar_connections")
    .select(
      "id, user_id, provider, access_token, refresh_token, expires_at",
    )
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (connErr || !connection) {
    return NextResponse.json(
      { error: connErr?.message ?? "Connection not found" },
      { status: 404 },
    );
  }
  if (connection.provider !== "google") {
    return NextResponse.json(
      { error: "Not a Google connection" },
      { status: 400 },
    );
  }

  // Refresh the access token if it's within 60s of expiring. Bottom-half
  // OAuth bookkeeping — we want every Google API call below to hold a
  // fresh token so this single function doesn't have to handle 401-retry
  // logic per request.
  let accessToken = decryptToken(connection.access_token);
  const expires = connection.expires_at
    ? new Date(connection.expires_at)
    : new Date(0);
  if (expires.getTime() - Date.now() < 60_000) {
    if (!connection.refresh_token) {
      return NextResponse.json(
        { error: "No refresh token — reconnect required" },
        { status: 400 },
      );
    }
    const refreshed = await refreshAccessToken(
      decryptToken(connection.refresh_token),
    );
    accessToken = refreshed.access_token;
    const newExpires = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();
    await supabase
      .from("calendar_connections")
      .update({
        access_token: encryptToken(accessToken),
        expires_at: newExpires,
      })
      .eq("id", connection.id);
  }

  const { data: calendars } = await supabase
    .from("external_calendars")
    .select("id, external_id, sync_token, selected")
    .eq("connection_id", connection.id);

  let totalChanged = 0;
  for (const cal of calendars ?? []) {
    if (!cal.selected) continue;
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const until = new Date();
    until.setDate(until.getDate() + 90);

    let result = await listEvents(accessToken, cal.external_id, {
      syncToken: cal.sync_token,
      timeMin: cal.sync_token ? undefined : since.toISOString(),
      timeMax: cal.sync_token ? undefined : until.toISOString(),
    });
    if (result.fullSyncRequired) {
      // Sync token expired — wipe local mirror for this calendar and pull
      // a fresh window. Cheaper than trying to reconcile manually.
      await supabase
        .from("external_events")
        .delete()
        .eq("calendar_id", cal.id);
      result = await listEvents(accessToken, cal.external_id, {
        timeMin: since.toISOString(),
        timeMax: until.toISOString(),
      });
    }

    // Partition into upserts vs deletes — Google marks cancelled events
    // with `status: "cancelled"` instead of removing them, so we have to
    // delete those locally to keep the mirror tight.
    const upserts: ReturnType<typeof toRow>[] = [];
    const cancelledIds: string[] = [];
    for (const ev of result.events) {
      if (ev.status === "cancelled") {
        cancelledIds.push(ev.id);
        continue;
      }
      if (!ev.start || !ev.end) continue;
      upserts.push(toRow(ev, cal.id));
    }
    if (upserts.length > 0) {
      const { error } = await supabase
        .from("external_events")
        .upsert(upserts, { onConflict: "calendar_id,external_id" });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    if (cancelledIds.length > 0) {
      await supabase
        .from("external_events")
        .delete()
        .eq("calendar_id", cal.id)
        .in("external_id", cancelledIds);
    }
    totalChanged += result.events.length;

    if (result.nextSyncToken) {
      await supabase
        .from("external_calendars")
        .update({ sync_token: result.nextSyncToken })
        .eq("id", cal.id);
    }
  }

  await supabase
    .from("calendar_connections")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", connection.id);

  return NextResponse.json({ ok: true, changed: totalChanged });
}

function toRow(
  ev: Parameters<typeof normaliseEventTimes>[0],
  calendarId: string,
) {
  const times = normaliseEventTimes(ev);
  return {
    calendar_id: calendarId,
    external_id: ev.id,
    title: ev.summary ?? "(no title)",
    description: ev.description ?? null,
    location: ev.location ?? null,
    start_at: times.start,
    end_at: times.end,
    all_day: times.all_day,
    etag: ev.etag ?? null,
    status: ev.status,
    busy_status: (ev.transparency === "transparent" ? "free" : "busy") as
      | "free"
      | "busy",
    html_link: ev.htmlLink ?? null,
    organizer_email: ev.organizer?.email ?? null,
    organizer_name: ev.organizer?.displayName ?? null,
  };
}
