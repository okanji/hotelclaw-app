import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { findAlreadyNotifiedUserIds } from "@/lib/notifications/server";

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
  /** True for broadcast mentions (@channel). When set, the server verifies
   *  channel membership + text content instead of `mentioned_users`. */
  broadcast: z.boolean().optional(),
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
  } catch (err) {
    console.error("[from-chat-event] JSON parse failed", err);
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
    broadcast: body.broadcast ?? false,
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
  const dedupedAdds = await findAlreadyNotifiedUserIds({
    userIds: [args.userId],
    type: "channel_added",
    match: { key: "channelId", value: args.streamChannelId },
  });
  if (dedupedAdds.has(args.userId)) {
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
  broadcast: boolean;
}): Promise<Response> {
  // Verify: pull the message from Stream and confirm the user is mentioned.
  // Two paths: direct @user mention (in `mentioned_users`) or broadcast
  // `@channel` mention (text contains the token AND the user is a member of
  // the channel — defense-in-depth so a misbehaving client can't fabricate
  // broadcast notifications for users not in the channel).
  let messageText = "";
  let byUserId: string | undefined;
  let byUserName: string | null = null;
  let channelType: "team" | "messaging" = "team";
  try {
    const res = await args.stream.getMessage(args.messageId);
    const msg = res.message;
    if (!msg) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    messageText = (msg.text ?? "").slice(0, 200);
    byUserId = msg.user?.id;
    byUserName = msg.user?.name ?? null;
    // Stream `cid` is `<type>:<id>` — the type decides whether the mention's
    // deep link routes to /dms or /chat. Treat anything non-`messaging` as a
    // team channel.
    channelType =
      ((msg.cid as string | undefined) ?? "").split(":")[0] === "messaging"
        ? "messaging"
        : "team";

    if (args.broadcast) {
      if (!/(?:^|\s)@channel\b/.test(msg.text ?? "")) {
        return NextResponse.json(
          { error: "no broadcast token in message" },
          { status: 403 },
        );
      }
      const channel = args.stream.channel(channelType, args.streamChannelId);
      const state = await channel.query({ members: { limit: 200 } });
      const isMember = (state.members ?? []).some(
        (m) => m.user?.id === args.userId,
      );
      if (!isMember) {
        return NextResponse.json(
          { error: "not a channel member" },
          { status: 403 },
        );
      }
      // Don't notify the sender of their own broadcast.
      if (byUserId === args.userId) {
        return NextResponse.json({ ok: true, skipped: "self" });
      }
    } else {
      const mentioned = (msg.mentioned_users ?? []).map((u) => u.id);
      if (!mentioned.includes(args.userId)) {
        return NextResponse.json(
          { error: "not mentioned" },
          { status: 403 },
        );
      }
    }
  } catch (e) {
    console.error("getMessage failed", e);
    return NextResponse.json({ error: "stream error" }, { status: 500 });
  }

  // Dedup by message id.
  const dedupedMentions = await findAlreadyNotifiedUserIds({
    userIds: [args.userId],
    type: "mention",
    match: { key: "messageId", value: args.messageId },
  });
  if (dedupedMentions.has(args.userId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const { error } = await args.service.from("notifications").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    type: "mention",
    payload: {
      channelId: args.streamChannelId,
      channelType,
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

