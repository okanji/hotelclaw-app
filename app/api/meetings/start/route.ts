import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Open a new meeting tied to a chat channel.
 *
 * Why a server roundtrip before the client touches Stream:
 *   • We need the meeting row to exist BEFORE Stream's transcription_ready
 *     webhook fires (which only carries the call id). The row maps
 *     call_id → property_id + channel_id so the webhook can stage the
 *     transcript and post the summary back into the right channel.
 *   • Membership check lives here (RLS would catch insert attempts but
 *     a clean 403 is friendlier than a Stream-coordinator-level failure).
 *
 * Stream `default` call type powers meetings (full A/V). Call id format:
 *   `meeting-<uuid>` — Stream-coordinator-safe characters only.
 */

type Body = {
  channelId: string;
  title?: string;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }

  // Resolve channel → property and check membership (RLS-friendly read).
  const { data: channel } = await supabase
    .from("chat_channels")
    .select("id, property_id, name, archived_at, stream_channel_id")
    .eq("stream_channel_id", body.channelId)
    .maybeSingle();

  if (!channel || channel.archived_at) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Defense in depth: the chat_channels read above is RLS-scoped, but the
  // service-client insert below isn't. Re-verify membership in the property
  // the channel belongs to before minting a meeting row under that scope.
  const membership = await getMembershipForProperty(channel.property_id);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Service client to insert with elevated trust — meetings.insert RLS would
  // allow this too, but using the service client keeps the host_id sentinel
  // out of any user-impersonation path.
  const service = createServiceClient();
  const callId = `meeting-${randomUUID()}`;
  const title =
    body.title?.trim() ||
    `Meeting in #${channel.name ?? "general"}`;

  const { data: meeting, error } = await service
    .from("meetings")
    .insert({
      property_id: channel.property_id,
      channel_id: channel.id,
      stream_call_id: callId,
      stream_call_type: "default",
      title,
      host_id: user.id,
    })
    .select("id, stream_call_id, stream_call_type")
    .single();

  if (error || !meeting) {
    // Supabase errors stringify to `{}` by default — pull the fields out
    // explicitly so the dev log shows the actual cause (missing table,
    // RLS denial, FK violation, etc.) instead of a useless empty object.
    console.error("meetings.insert failed", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
    return NextResponse.json(
      {
        error: "could not create meeting",
        // Surface the underlying cause to the client in dev so the toast
        // is informative; the chained generic error stays in prod logs.
        cause:
          process.env.NODE_ENV === "production"
            ? undefined
            : error?.message ?? "no row returned",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    meetingId: meeting.id,
    callId: meeting.stream_call_id,
    callType: meeting.stream_call_type,
  });
}
