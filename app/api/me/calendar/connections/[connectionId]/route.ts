import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stopGoogleWatch } from "@/lib/calendar/google";
import { stopMicrosoftSubscription } from "@/lib/calendar/microsoft";
import { decryptToken } from "@/lib/calendar/token-crypto";

/**
 * `DELETE /api/me/calendar/connections/:id`
 *
 * Removes the connection (cascades to `external_calendars` +
 * `external_events`). Best-effort cleanup of the provider-side push
 * subscription so we don't leak a webhook target — failures there don't
 * block the DB delete; orphaned channels expire on their own.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("calendar_connections")
    .select(
      "id, provider, access_token, refresh_token, push_subscription",
    )
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (connection.push_subscription) {
    try {
      const accessToken = decryptToken(connection.access_token);
      const sub = connection.push_subscription as Record<string, unknown>;
      if (connection.provider === "google") {
        await stopGoogleWatch(accessToken, sub);
      } else {
        await stopMicrosoftSubscription(accessToken, sub);
      }
    } catch {
      // Swallow — DB delete still proceeds; provider channel will expire.
    }
  }

  const { error } = await supabase
    .from("calendar_connections")
    .delete()
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
