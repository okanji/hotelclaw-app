import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty, getSessionUser } from "@/lib/auth/session";
import { eveOrigin, fleetServiceHeaders } from "@/lib/fleet/eve-session";

/**
 * Read-only transcript proxy for fleet sessions. The client NEVER talks to
 * /eve/v1 with arbitrary session ids — this route's row check IS the
 * tenancy gate: the eve session id must be recorded on a bot_chat_sessions
 * row belonging to the requested property (404 otherwise), and the caller
 * must be a member of that property. The eve stream replays from index 0
 * and stays open; the caller's abort propagates upstream via
 * request.signal so dev-server connections don't leak.
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ propertyId: string; eveSessionId: string }> },
) {
  const { propertyId, eveSessionId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { data: row } = await service
    .from("bot_chat_sessions")
    .select("id")
    .eq("property_id", propertyId)
    .eq("eve_session_id", eveSessionId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const upstream = await fetch(
    `${eveOrigin()}/eve/v1/session/${encodeURIComponent(eveSessionId)}/stream`,
    {
      headers: fleetServiceHeaders({ propertyId, userId: user.id }),
      signal: request.signal,
    },
  ).catch(() => null);
  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json({ error: "session stream unavailable" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
