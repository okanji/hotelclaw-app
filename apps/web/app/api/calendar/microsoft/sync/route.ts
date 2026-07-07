import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listEventsDelta,
  normaliseEventTimes,
  refreshAccessToken,
  type GraphEvent,
} from "@/lib/calendar/microsoft";
import { decryptToken, encryptToken } from "@/lib/calendar/token-crypto";

/**
 * Microsoft Graph sync. Same shape as the Google route: refresh access
 * token if near expiry, then walk each selected calendar incrementally
 * via Graph's `delta` API and upsert into `external_events`.
 *
 * `@removed` items in a delta response indicate cancellations; we drop
 * those rows locally to keep the mirror consistent.
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
  if (connection.provider !== "microsoft") {
    return NextResponse.json(
      { error: "Not a Microsoft connection" },
      { status: 400 },
    );
  }

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

    let result = await listEventsDelta(accessToken, cal.external_id, {
      deltaLink: cal.sync_token,
      startDateTime: cal.sync_token ? undefined : since.toISOString(),
      endDateTime: cal.sync_token ? undefined : until.toISOString(),
    });
    if (result.fullSyncRequired) {
      await supabase
        .from("external_events")
        .delete()
        .eq("calendar_id", cal.id);
      result = await listEventsDelta(accessToken, cal.external_id, {
        startDateTime: since.toISOString(),
        endDateTime: until.toISOString(),
      });
    }

    const upserts: ReturnType<typeof toRow>[] = [];
    const removedIds: string[] = [];
    for (const ev of result.events) {
      if (ev["@removed"] || ev.isCancelled) {
        removedIds.push(ev.id);
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
    if (removedIds.length > 0) {
      await supabase
        .from("external_events")
        .delete()
        .eq("calendar_id", cal.id)
        .in("external_id", removedIds);
    }
    totalChanged += result.events.length;

    if (result.nextDeltaLink) {
      await supabase
        .from("external_calendars")
        .update({ sync_token: result.nextDeltaLink })
        .eq("id", cal.id);
    }
  }

  await supabase
    .from("calendar_connections")
    .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
    .eq("id", connection.id);

  return NextResponse.json({ ok: true, changed: totalChanged });
}

function toRow(ev: GraphEvent, calendarId: string) {
  const times = normaliseEventTimes(ev);
  return {
    calendar_id: calendarId,
    external_id: ev.id,
    title: ev.subject ?? "(no title)",
    description: ev.bodyPreview ?? null,
    location: ev.location?.displayName ?? null,
    start_at: times.start,
    end_at: times.end,
    all_day: times.all_day,
    status: ev.isCancelled ? "cancelled" : "confirmed",
    busy_status: ev.showAs ?? "busy",
    html_link: ev.webLink ?? null,
    organizer_email: ev.organizer?.emailAddress.address ?? null,
    organizer_name: ev.organizer?.emailAddress.name ?? null,
  };
}
