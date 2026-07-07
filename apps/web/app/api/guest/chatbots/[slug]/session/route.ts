import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { mintGuestSession, verifyGuestSession } from "@/lib/chatbots/guest-session";
import { parseChatbotConfig } from "@/lib/chatbots/schema";

/**
 * POST /api/guest/chatbots/:slug/session — bootstrap (or resume) a guest
 * conversation. PUBLIC: no Supabase auth; the service client does all reads
 * and the unguessable slug is the only way to address a bot. Never returns
 * tenant internals (no property_id, no config beyond guest-visible fields).
 *
 * Body: { token?: existing session token, room?: from a ?room= QR param }
 * Returns the session token, guest-visible bot meta, and the transcript so
 * a returning guest resumes where they left off.
 */

const Body = z.object({
  token: z.string().max(200).nullish(),
  room: z.string().max(20).nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-f0-9]{16,64}$/.test(slug)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: bot } = await supabase
    .from("chatbots")
    .select("id, property_id, name, status, config, session_message_cap")
    .eq("public_slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  if (!bot || bot.status === "draft") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const config = parseChatbotConfig(bot.config);
  const { data: property } = await supabase
    .from("properties")
    .select("name")
    .eq("id", bot.property_id)
    .maybeSingle();

  const botMeta = {
    status: bot.status,
    displayName: config.appearance.displayName,
    avatarEmoji: config.appearance.avatarEmoji,
    brandColor: config.appearance.brandColor ?? null,
    theme: config.appearance.theme,
    greeting: config.greeting,
    suggestedQuestions: config.suggestedQuestions.filter((q) => q.trim()),
    propertyName: property?.name ?? "this property",
  };

  if (bot.status === "paused") {
    return NextResponse.json({ paused: true, botMeta });
  }

  // Resume: a valid token for THIS bot returns the existing conversation.
  const existing = verifyGuestSession(body.token ?? null);
  if (existing && existing.chatbotId === bot.id) {
    const { data: convo } = await supabase
      .from("chatbot_conversations")
      .select("id, status")
      .eq("id", existing.conversationId)
      .eq("chatbot_id", bot.id)
      .maybeSingle();
    if (convo) {
      const { data: messages } = await supabase
        .from("chatbot_messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: true })
        .limit(100);
      return NextResponse.json({
        token: body.token,
        conversationId: convo.id,
        conversationStatus: convo.status,
        messages: messages ?? [],
        botMeta,
      });
    }
  }

  // Fresh conversation.
  const { data: convo, error } = await supabase
    .from("chatbot_conversations")
    .insert({
      chatbot_id: bot.id,
      property_id: bot.property_id,
      session_token: crypto.randomUUID(),
      channel: "web",
      room_number: body.room?.trim() || null,
    })
    .select("id, status")
    .single();
  if (error || !convo) {
    console.error("[guest-session] conversation insert failed", error?.message);
    return NextResponse.json({ error: "couldn't start conversation" }, { status: 500 });
  }

  return NextResponse.json({
    token: mintGuestSession({ conversationId: convo.id, chatbotId: bot.id }),
    conversationId: convo.id,
    conversationStatus: convo.status,
    messages: [],
    botMeta,
  });
}
