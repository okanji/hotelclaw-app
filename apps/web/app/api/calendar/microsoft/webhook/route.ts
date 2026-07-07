import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/calendar/token-crypto";
import {
  listEventsDelta,
  normaliseEventTimes,
  refreshAccessToken,
  type GraphEvent,
} from "@/lib/calendar/microsoft";

/**
 * `POST /api/calendar/microsoft/webhook`
 *
 * Graph subscription delivery happens here. Two distinct request shapes:
 *
 *   1. **Validation handshake.** When we create the subscription, Graph
 *      immediately POSTs with `?validationToken=…` and a (usually empty)
 *      body. We have to echo the raw token back as `text/plain` within
 *      ~10s or the subscription creation is rejected.
 *
 *   2. **Change notification.** JSON body: `{ value: [{ subscriptionId,
 *      clientState, resourceData, … }] }`. We validate `clientState`
 *      against the per-subscription secret we stored at create time, then
 *      delta-sync the matching connection.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  const supabase = createServiceClient();
  const body = (await request.json()) as {
    value?: Array<{
      subscriptionId: string;
      clientState: string;
      resource?: string;
    }>;
  };

  for (const notification of body.value ?? []) {
    const { data: conn } = await supabase
      .from("calendar_connections")
      .select(
        "id, user_id, provider, access_token, refresh_token, expires_at, push_subscription",
      )
      .filter(
        "push_subscription->>subscriptionId",
        "eq",
        notification.subscriptionId,
      )
      .maybeSingle();
    if (!conn) continue;
    const sub = conn.push_subscription as {
      subscriptionId: string;
      clientState: string;
    } | null;
    if (sub?.clientState !== notification.clientState) continue;
    if (conn.provider !== "microsoft") continue;

    // Microsoft subscriptions are per-mailbox, not per-calendar. We delta-
    // sync every selected calendar tied to the connection so the mirror
    // catches up regardless of which calendar the change landed in.
    const { data: cals } = await supabase
      .from("external_calendars")
      .select("id, external_id, sync_token, selected")
      .eq("connection_id", conn.id);
    if (!cals) continue;

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

    for (const cal of cals) {
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
      const removed: string[] = [];
      for (const ev of result.events) {
        if (ev["@removed"] || ev.isCancelled) {
          removed.push(ev.id);
          continue;
        }
        if (!ev.start || !ev.end) continue;
        upserts.push(toRow(ev, cal.id));
      }
      if (upserts.length > 0) {
        await supabase
          .from("external_events")
          .upsert(upserts, { onConflict: "calendar_id,external_id" });
      }
      if (removed.length > 0) {
        await supabase
          .from("external_events")
          .delete()
          .eq("calendar_id", cal.id)
          .in("external_id", removed);
      }
      if (result.nextDeltaLink) {
        await supabase
          .from("external_calendars")
          .update({ sync_token: result.nextDeltaLink })
          .eq("id", cal.id);
      }
    }
    await supabase
      .from("calendar_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      })
      .eq("id", conn.id);
  }

  return NextResponse.json({ ok: true });
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
