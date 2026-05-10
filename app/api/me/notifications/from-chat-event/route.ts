import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";

/**
 * Bridge endpoint: the client subscribes to Stream events and POSTs the
 * relevant ones here so we can persist them as rows in `notifications`.
 *
 * Why route through the server instead of writing client-side?
 *   1. `notifications` has no public insert policy — only the service role
 *      can write, which prevents a misbehaving frontend from spamming.
 *   2. We verify the event against Stream server-side before persisting —
 *      otherwise any signed-in user could fabricate notifications.
 *   3. We dedup so multi-tab clients don't create duplicates.
 */

const ChannelAddedBody = z.object({
  kind: z.literal("channel_added"),
  propertyId: z.string().uuid(),
  channelId: z.string().min(1),
  byUserId: z.string().optional(),
});

const MentionBody = z.object({
  kind: z.literal("mention"),
  propertyId: z.string().uuid(),
  channelId: z.string().min(1),
  messageId: z.string().min(1),
});

const Body = z.discriminatedUnion("kind", [ChannelAddedBody, MentionBody]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const body = parsed.data;

  // Membership gate.
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("property_id", body.propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not a member" }, { status: 403 });
  }

  const service = createServiceClient();
  const stream = getStreamServer();

  if (body.kind === "channel_added") {
    return await handleChannelAdded({
      service,
      stream,
      userId: user.id,
      propertyId: body.propertyId,
      streamChannelId: body.channelId,
      byUserId: body.byUserId ?? null,
    });
  }

  return await handleMention({
    service,
    stream,
    userId: user.id,
    propertyId: body.propertyId,
    streamChannelId: body.channelId,
    messageId: body.messageId,
  });
}

async function handleChannelAdded(args: {
  service: ReturnType<typeof createServiceClient>;
  stream: ReturnType<typeof getStreamServer>;
  userId: string;
  propertyId: string;
  streamChannelId: string;
  byUserId: string | null;
}): Promise<Response> {
  // Verify the user really is a member of that Stream channel (defense-in-depth).
  let channelName = args.streamChannelId;
  try {
    const channel = args.stream.channel("team", args.streamChannelId);
    const state = await channel.query({ members: { limit: 100 } });
    const isMember = (state.members ?? []).some(
      (m) => m.user?.id === args.userId,
    );
    if (!isMember) {
      return NextResponse.json({ error: "not a channel member" }, { status: 403 });
    }
    channelName =
      (state.channel as { name?: string } | undefined)?.name ??
      args.streamChannelId;
  } catch (e) {
    console.error("channel.query failed", e);
    return NextResponse.json({ error: "stream error" }, { status: 500 });
  }

  // Dedup: skip if we already notified this user about this channel-add.
  if (
    await alreadyNotified(args.service, args.userId, "channel_added", {
      key: "channelId",
      value: args.streamChannelId,
    })
  ) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let byUserName: string | null = null;
  if (args.byUserId) {
    const { data } = await args.service
      .from("profiles")
      .select("full_name")
      .eq("id", args.byUserId)
      .maybeSingle();
    byUserName = data?.full_name ?? null;
  }

  const { error } = await args.service.from("notifications").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    type: "channel_added",
    payload: {
      channelId: args.streamChannelId,
      channelName,
      byUserId: args.byUserId,
      byUserName,
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function handleMention(args: {
  service: ReturnType<typeof createServiceClient>;
  stream: ReturnType<typeof getStreamServer>;
  userId: string;
  propertyId: string;
  streamChannelId: string;
  messageId: string;
}): Promise<Response> {
  // Verify: pull the message from Stream and confirm the user is mentioned.
  let messageText = "";
  let byUserId: string | undefined;
  let byUserName: string | null = null;
  try {
    const res = await args.stream.getMessage(args.messageId);
    const msg = res.message;
    if (!msg) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    const mentioned = (msg.mentioned_users ?? []).map((u) => u.id);
    if (!mentioned.includes(args.userId)) {
      return NextResponse.json(
        { error: "not mentioned" },
        { status: 403 },
      );
    }
    messageText = (msg.text ?? "").slice(0, 200);
    byUserId = msg.user?.id;
    byUserName = msg.user?.name ?? null;
  } catch (e) {
    console.error("getMessage failed", e);
    return NextResponse.json({ error: "stream error" }, { status: 500 });
  }

  // Dedup by message id.
  if (
    await alreadyNotified(args.service, args.userId, "mention", {
      key: "messageId",
      value: args.messageId,
    })
  ) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const { error } = await args.service.from("notifications").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    type: "mention",
    payload: {
      channelId: args.streamChannelId,
      messageId: args.messageId,
      byUserId: byUserId ?? null,
      byUserName,
      preview: messageText,
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function alreadyNotified(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  type: string,
  match: { key: string; value: string },
): Promise<boolean> {
  // Last 24h window. Cheap query via the user/created_at index.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await service
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", since)
    .contains("payload", { [match.key]: match.value });
  return !!data && data.length > 0;
}
