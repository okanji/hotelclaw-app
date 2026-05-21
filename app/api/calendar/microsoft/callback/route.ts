import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForTokens,
  getUserInfo,
  listCalendars,
} from "@/lib/calendar/microsoft";
import { consumeOAuth } from "@/lib/calendar/oauth-state";

/**
 * Microsoft OAuth callback. Mirrors the Google flow: exchange the code,
 * stash tokens, mirror the calendar list, kick a first sync, bounce back.
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
          provider: "microsoft" as const,
          account_email: userInfo.email,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
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

    const calendars = await listCalendars(tokens.access_token);
    if (calendars.length > 0) {
      await supabase.from("external_calendars").upsert(
        calendars.map((c) => ({
          connection_id: connection.id,
          external_id: c.id,
          name: c.name,
          color: c.hexColor?.replace(/^#/, "") ?? null,
          is_primary: !!c.isDefaultCalendar,
          selected: !!c.isDefaultCalendar,
        })),
        { onConflict: "connection_id,external_id" },
      );
    }

    try {
      await fetch(
        new URL(
          `/api/calendar/microsoft/sync?connectionId=${connection.id}`,
          request.url,
        ),
        {
          method: "POST",
          headers: { cookie: request.headers.get("cookie") ?? "" },
        },
      );
    } catch (e) {
      await supabase
        .from("calendar_connections")
        .update({
          last_sync_error:
            e instanceof Error ? e.message : "Initial sync failed",
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
