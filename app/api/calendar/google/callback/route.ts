import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  getUserInfo,
  listCalendars,
} from "@/lib/calendar/google";
import { consumeOAuth } from "@/lib/calendar/oauth-state";
import { encryptToken } from "@/lib/calendar/token-crypto";
import {
  ensureGooglePushForConnection,
  primaryGoogleCalendar,
} from "@/lib/calendar/push";

/**
 * `GET /api/calendar/google/callback?code=…&state=…`
 *
 * Exchanges the auth code for tokens, captures the account email +
 * calendar list, upserts everything into our tables, then bounces the user
 * back to the `next` URL the connect handler stashed. The first sync runs
 * inline so the events show up immediately — webhook-driven incremental
 * syncs (push notifications) come later.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const verified = await consumeOAuth(state);
  if (!verified) {
    return errorRedirect(request, "Invalid OAuth state");
  }
  if (!code) {
    return errorRedirect(request, "Missing authorization code");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const userInfo = await getUserInfo(tokens.access_token);
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    const { data: connection, error: upsertErr } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "google" as const,
          account_email: userInfo.email,
          access_token: encryptToken(tokens.access_token),
          refresh_token: tokens.refresh_token
            ? encryptToken(tokens.refresh_token)
            : null,
          expires_at: expiresAt,
          last_sync_error: null,
        },
        { onConflict: "user_id,provider,account_email" },
      )
      .select("id")
      .single();
    if (upsertErr || !connection) {
      return errorRedirect(
        request,
        upsertErr?.message ?? "Failed to persist connection",
      );
    }

    // Mirror the calendar list so the sidebar can render checkboxes.
    const calendars = await listCalendars(tokens.access_token);
    if (calendars.length > 0) {
      await supabase.from("external_calendars").upsert(
        calendars.map((c) => ({
          connection_id: connection.id,
          external_id: c.id,
          name: c.summary,
          description: c.description ?? null,
          color: c.backgroundColor?.replace(/^#/, "") ?? null,
          is_primary: !!c.primary,
          selected: !!c.primary, // start with just the primary visible
        })),
        { onConflict: "connection_id,external_id" },
      );
    }

    // Open the push channel before the first sync so Google's initial
    // "sync" notification arrives after the row exists. The helper
    // swallows failures (e.g. no CALENDAR_WEBHOOK_BASE configured in
    // local dev), keeping push opt-in.
    const primary = primaryGoogleCalendar(calendars);
    await ensureGooglePushForConnection(
      // Service-role client isn't needed here — the caller is the user.
      // But ensureGooglePushForConnection expects a Database client; the
      // RLS-bound `supabase` works equivalently for self-owned rows.
      supabase as unknown as Parameters<typeof ensureGooglePushForConnection>[0],
      {
        id: connection.id,
        access_token: encryptToken(tokens.access_token),
        push_subscription: null,
      },
      primary?.id ?? null,
    );

    // Kick a first sync inline. If it errors we still want the connection
    // to land — the sidebar can show the error and the user can retry.
    try {
      const syncRes = await fetch(
        new URL(
          `/api/calendar/google/sync?connectionId=${connection.id}`,
          request.url,
        ),
        { method: "POST", headers: { cookie: request.headers.get("cookie") ?? "" } },
      );
      if (!syncRes.ok) {
        await supabase
          .from("calendar_connections")
          .update({ last_sync_error: await syncRes.text() })
          .eq("id", connection.id);
      }
    } catch (e) {
      await supabase
        .from("calendar_connections")
        .update({
          last_sync_error: e instanceof Error ? e.message : "Initial sync failed",
        })
        .eq("id", connection.id);
    }

    return NextResponse.redirect(new URL(verified.next, request.url));
  } catch (e) {
    return errorRedirect(
      request,
      e instanceof Error ? e.message : "Connection failed",
    );
  }
}

function errorRedirect(request: Request, message: string): Response {
  const url = new URL("/", request.url);
  url.searchParams.set("calendar_error", message);
  return NextResponse.redirect(url);
}
