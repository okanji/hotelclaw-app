import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { getStreamServer } from "@/lib/stream/server";

/**
 * POST /api/properties/:propertyId/handover — publish a handover note.
 * Inserts the history row and posts the note to the chosen channel under
 * the author's own identity (the channel message is the actual shift-change
 * communication; the row lets the next shift's brief cite it).
 *
 * GET — the latest handover, for "previous handover" references.
 */

const Body = z.object({
  bodyMd: z.string().min(1).max(8000),
  channelId: z.string().uuid().nullable().optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();

  // Post to the channel first so the row can carry the message id.
  let chatMessageId: string | null = null;
  const channelId = parsed.data.channelId ?? null;
  if (channelId) {
    const { data: channel } = await service
      .from("chat_channels")
      .select("stream_channel_id, stream_channel_type")
      .eq("id", channelId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }
    try {
      const stream = getStreamServer();
      const chan = stream.channel(
        channel.stream_channel_type ?? "team",
        channel.stream_channel_id,
      );
      const sent = await chan.sendMessage(
        {
          text: `🔁 **Shift handover**\n\n${parsed.data.bodyMd}`,
          user_id: user.id,
          // Custom field so the chat UI can badge handover messages — same
          // open-cast convention as postSummaryToChannel.
          is_handover: true,
        } as Record<string, unknown>,
        { skip_push: true },
      );
      chatMessageId = sent.message?.id ?? null;
    } catch (err) {
      console.error("[handover] channel post failed", err);
      return NextResponse.json(
        { error: "couldn't post to the channel" },
        { status: 502 },
      );
    }
  }

  const { data: row, error } = await service
    .from("handovers")
    .insert({
      property_id: propertyId,
      author_id: user.id,
      body_md: parsed.data.bodyMd,
      window_start: parsed.data.windowStart ?? null,
      window_end: parsed.data.windowEnd ?? null,
      channel_id: channelId,
      chat_message_id: chatMessageId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[handover] insert failed", error.message);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
  return NextResponse.json({ handoverId: row.id, chatMessageId });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data } = await supabase
    .from("handovers")
    .select("id, author_id, body_md, window_start, window_end, created_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ handover: data ?? null });
}
