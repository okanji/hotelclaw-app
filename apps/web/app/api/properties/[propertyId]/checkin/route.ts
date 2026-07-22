import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { getStreamServer } from "@/lib/stream/server";

/**
 * POST /api/properties/:propertyId/checkin — the morning check-in (C1
 * phase 1). Two actions:
 *
 *   draft   — the user's conversational answers (priorities / blockers /
 *             notes) come in rough (often dictated); Haiku composes them
 *             into a tidy morning brief they review before sharing.
 *   publish — post the (edited) brief to a channel under the author's own
 *             identity — replaces hand-writing the daily entry in the
 *             management-briefing channel. Mirrors the handover route's
 *             posting pattern; the channel message IS the artifact.
 */

const DRAFT_MODEL = "claude-haiku-4-5-20251001";

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("draft"),
    answers: z.object({
      priorities: z.string().max(2000),
      blockers: z.string().max(2000),
      notes: z.string().max(2000),
    }),
  }),
  z.object({
    action: z.literal("publish"),
    bodyMd: z.string().min(1).max(8000),
    channelId: z.string().uuid(),
  }),
]);

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

  if (parsed.data.action === "draft") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "AI not configured" }, { status: 503 });
    }
    const { priorities, blockers, notes } = parsed.data.answers;
    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    try {
      const result = await generateText({
        model: anthropic(DRAFT_MODEL),
        system: [
          "You turn a hotel manager's rough (often dictated) morning check-in answers into a crisp brief for their team channel.",
          "Output ONLY the brief body in light markdown: a '**Today's priorities**' bulleted list, then '**Blocked / need help**' (omit the section if empty), then '**Also**' (omit if empty).",
          "Keep the author's meaning and specifics exactly — tidy the language, never invent content. No greeting, no sign-off, no preamble.",
        ].join("\n"),
        prompt: `Priorities: ${priorities || "(none given)"}\n\nBlocked or need help: ${blockers || "(none)"}\n\nAnything else: ${notes || "(none)"}`,
        temperature: 0.2,
      });
      return NextResponse.json({ bodyMd: result.text.trim() });
    } catch (err) {
      console.error("[checkin] draft failed", err);
      return NextResponse.json({ error: "draft failed" }, { status: 500 });
    }
  }

  // publish
  const service = createServiceClient();
  const { data: channel } = await service
    .from("chat_channels")
    .select("stream_channel_id, stream_channel_type")
    .eq("id", parsed.data.channelId)
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
        text: `🌅 **Morning brief**\n\n${parsed.data.bodyMd}`,
        user_id: user.id,
        is_morning_brief: true,
      } as Record<string, unknown>,
      { skip_push: true },
    );
    return NextResponse.json({ chatMessageId: sent.message?.id ?? null });
  } catch (err) {
    console.error("[checkin] channel post failed", err);
    return NextResponse.json(
      { error: "couldn't post to the channel" },
      { status: 502 },
    );
  }
}
