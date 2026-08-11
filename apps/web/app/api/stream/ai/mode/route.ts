import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { getStreamServer } from "@/lib/stream/server";
import { setChannelAiSettings } from "@/lib/stream/ai-adapter";

/**
 * Toggle the per-channel AI reply settings.
 *
 *   POST { channelId, channelType, mode, sensitivity? }
 *
 * `mode` is one of:
 *   - "mention": reply only when the bot is @-mentioned (default)
 *   - "auto":    reply on mention OR when a Haiku classifier decides the
 *                bot would add value — `sensitivity` tunes that decision
 *   - "always":  reply to every non-bot message in the channel
 *
 * `sensitivity` (only meaningful for mode === "auto") is one of:
 *   - "conservative", "balanced" (default), "eager"
 *
 * Stored as Stream channel custom fields; read by the message-new webhook.
 * Caller must be a member of the channel.
 */

const Body = z.object({
  channelId: z.string().min(1),
  channelType: z.enum(["team", "messaging"]).default("team"),
  mode: z.enum(["mention", "auto", "always", "engaged"]),
  sensitivity: z.enum(["conservative", "balanced", "eager"]).optional(),
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
    console.error("[stream-ai-mode] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { channelId, channelType, mode, sensitivity } = parsed.data;

  // Verify caller is a member before letting them flip channel-wide AI mode.
  try {
    const stream = getStreamServer();
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
  } catch (e) {
    console.error("[stream-ai-mode] channel preflight failed", e);
    return NextResponse.json({ error: "stream error" }, { status: 500 });
  }

  try {
    await setChannelAiSettings(channelId, channelType, { mode, sensitivity });
  } catch (e) {
    console.error("[stream-ai-mode] setChannelAiSettings failed", e);
    return NextResponse.json(
      { error: "could not set mode" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, mode, sensitivity });
}
