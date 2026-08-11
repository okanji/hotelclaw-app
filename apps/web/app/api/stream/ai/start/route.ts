import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getStreamServer } from "@/lib/stream/server";
import { addBotToChannel, getBotUserId } from "@/lib/stream/ai-adapter";

/**
 * Activate the in-channel AI bot for a Stream channel.
 *
 * Flow:
 *   1. Verify the caller is signed in and is a member of the requested
 *      channel (defense-in-depth on top of Stream's own membership check).
 *   2. Add the bot user to the channel as a member (upsert + addMembers).
 *
 * The bot itself is webhook-driven — once it's a channel member, the
 * `message.new` webhook (`app/api/stream/webhook/message-new/route.ts`)
 * decides whether to reply on each incoming message based on the channel's
 * `ai_mode` custom field (default: only when @-mentioned).
 *
 * Deactivate via `/api/stream/ai/stop` (planned) — for now, remove the bot
 * from members via Stream's API or the dashboard.
 */

const Body = z.object({
  channelId: z.string().min(1),
  channelType: z.enum(["team", "messaging"]).optional(),
});

export async function POST(request: NextRequest) {
  // Cookie (web) or Bearer (mobile) — same handler for both surfaces.
  const { user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    console.error("[stream-ai-start] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { channelId, channelType = "team" } = parsed.data;

  // Defense-in-depth: ensure the caller is a member of this Stream channel.
  // Without this, anyone signed in could add the bot to arbitrary channels.
  const stream = getStreamServer();
  const botUserId = getBotUserId();
  try {
    const channel = stream.channel(channelType, channelId);
    const state = await channel.query({ members: { limit: 200 } });
    const callerIsMember = (state.members ?? []).some(
      (m) => m.user?.id === user.id,
    );
    if (!callerIsMember) {
      return NextResponse.json(
        { error: "not a channel member" },
        { status: 403 },
      );
    }
    const botAlreadyMember = (state.members ?? []).some(
      (m) => m.user?.id === botUserId,
    );
    if (!botAlreadyMember) {
      await addBotToChannel(channelId, channelType);
    }
  } catch (e) {
    console.error("[stream-ai-start] channel preflight failed", e);
    return NextResponse.json({ error: "stream error" }, { status: 500 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Bot is added (so it shows in autocomplete) but generation will fail
    // until the key is configured — surface that distinction to the UI.
    return NextResponse.json({
      ok: true,
      botUserId,
      warning: "ANTHROPIC_API_KEY not configured — bot won't reply yet",
    });
  }

  return NextResponse.json({ ok: true, botUserId });
}
