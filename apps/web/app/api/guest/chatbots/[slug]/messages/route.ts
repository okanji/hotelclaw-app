import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { bearerToken, verifyGuestSession } from "@/lib/chatbots/guest-session";
import { parseChatbotConfig } from "@/lib/chatbots/schema";
import {
  checkDailyBudget,
  checkGuestRateLimits,
  recordUsage,
} from "@/lib/chatbots/limits";
import { runGuestBot } from "@/lib/ai/guest-bot/run-guest-bot";
import {
  buildGuestBotTools,
  performGuestHandoff,
} from "@/lib/ai/guest-bot/tools/registry";
import type { ModelMessage } from "ai";

/**
 * The guest conversation endpoint. PUBLIC — gated by the HMAC session
 * token, never Supabase auth.
 *
 * POST {text} — send a guest message.
 *   Streamed bot replies come back as `text/plain` chunks
 *   (`toTextStreamResponse`); every non-generation outcome (with staff,
 *   over budget, session cap) is JSON `{state, reply?}` — the client
 *   branches on content-type. After each turn the client re-syncs via GET
 *   (the turn may have flipped the conversation to human mode).
 * POST {handoff: true} — the guest tapped "Talk to a human": deterministic
 *   escalation, no model in the loop.
 * GET ?after=<ISO> — poll for new messages + status (staff replies land
 *   while the bot is muted; guests have no Realtime, so they poll).
 */

export const maxDuration = 60;

const Body = z.object({
  text: z.string().max(2000).optional(),
  handoff: z.boolean().optional(),
});

const HISTORY_WINDOW = 30;

type Ctx = { params: Promise<{ slug: string }> };

async function authorize(request: NextRequest, slug: string) {
  const session = verifyGuestSession(bearerToken(request));
  if (!session) return null;
  const supabase = createServiceClient();
  const { data: bot } = await supabase
    .from("chatbots")
    .select("id, property_id, name, status, config, session_message_cap, daily_message_cap")
    .eq("public_slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  if (!bot || bot.id !== session.chatbotId) return null;
  const { data: conversation } = await supabase
    .from("chatbot_conversations")
    .select("id, status, guest_name, guest_email, guest_phone, room_number, message_count, outcome_meta")
    .eq("id", session.conversationId)
    .eq("chatbot_id", bot.id)
    .maybeSingle();
  if (!conversation) return null;
  return { bot, conversation, supabase };
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const auth = await authorize(request, slug);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const after = request.nextUrl.searchParams.get("after");
  let query = auth.supabase
    .from("chatbot_messages")
    .select("id, role, content, attachments, created_at")
    .eq("conversation_id", auth.conversation.id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (after && !Number.isNaN(Date.parse(after))) {
    query = query.gt("created_at", after);
  }
  const { data: messages } = await query;
  return NextResponse.json({
    status: auth.conversation.status,
    messages: messages ?? [],
  });
}

const FeedbackBody = z.object({
  messageId: z.string().uuid(),
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]),
});

/** PATCH — guest thumbs on a bot reply. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const auth = await authorize(request, slug);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof FeedbackBody>;
  try {
    body = FeedbackBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("chatbot_messages")
    .update({ feedback: body.feedback })
    .eq("id", body.messageId)
    .eq("conversation_id", auth.conversation.id)
    .eq("role", "bot")
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const auth = await authorize(request, slug);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { bot, conversation, supabase } = auth;

  if (bot.status !== "published") {
    return NextResponse.json({ state: "paused" }, { status: 200 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const config = parseChatbotConfig(bot.config);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const rate = await checkGuestRateLimits({
    conversationId: conversation.id,
    chatbotId: bot.id,
    ip,
  });
  if (!rate.ok) {
    return NextResponse.json({ state: "rate_limited", reply: rate.reason }, { status: 429 });
  }

  const now = new Date().toISOString();

  // Deterministic "Talk to a human" — no model, no text required.
  if (body.handoff) {
    if (conversation.status !== "human") {
      const escalate = config.actions.find(
        (a) => a.type === "escalate_to_human",
      );
      await performGuestHandoff(
        {
          propertyId: bot.property_id,
          chatbotId: bot.id,
          chatbotName: bot.name,
          conversationId: conversation.id,
        },
        escalate?.type === "escalate_to_human"
          ? escalate.config
          : { notifyRoles: ["owner", "manager"] },
        {
          summary: "The guest tapped 'Talk to a human' on the chat page.",
          reason: "guest requested a person",
        },
      );
      await supabase.from("chatbot_messages").insert({
        conversation_id: conversation.id,
        property_id: bot.property_id,
        role: "system",
        content: config.guardrails.handoffMessage,
        created_at: now,
      });
    }
    return NextResponse.json({
      state: "human",
      reply: config.guardrails.handoffMessage,
    });
  }

  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // Persist the guest turn first — even when the bot is muted or capped,
  // staff see what the guest said.
  await supabase.from("chatbot_messages").insert({
    conversation_id: conversation.id,
    property_id: bot.property_id,
    role: "guest",
    content: text,
    created_at: now,
  });
  await supabase
    .from("chatbot_conversations")
    .update({
      message_count: conversation.message_count + 1,
      last_message_at: now,
    })
    .eq("id", conversation.id);

  // Structurally muted while a human owns the conversation.
  if (conversation.status === "human") {
    return NextResponse.json({ state: "human" });
  }

  const budget = await checkDailyBudget({
    chatbotId: bot.id,
    dailyCap: bot.daily_message_cap,
  });
  if (!budget.ok) {
    await supabase.from("chatbot_messages").insert({
      conversation_id: conversation.id,
      property_id: bot.property_id,
      role: "bot",
      content: config.guardrails.fallbackMessage,
    });
    return NextResponse.json({
      state: "capped",
      reply: config.guardrails.fallbackMessage,
    });
  }

  // Session cap: at the cap the bot is told to wind down; well past it we
  // stop generating entirely.
  const { count: guestCount } = await supabase
    .from("chatbot_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("role", "guest");
  const sessionCapReached = (guestCount ?? 0) >= bot.session_message_cap;
  if ((guestCount ?? 0) > bot.session_message_cap + 5) {
    return NextResponse.json({
      state: "session_capped",
      reply: config.guardrails.fallbackMessage,
    });
  }

  // History → model messages. Staff/system rows are folded in as context
  // notes so a post-handoff bot turn knows what the human said.
  const { data: history } = await supabase
    .from("chatbot_messages")
    .select("role, content")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);
  const messages: ModelMessage[] = (history ?? [])
    .reverse()
    .map((m): ModelMessage => {
      if (m.role === "bot") return { role: "assistant", content: m.content };
      if (m.role === "staff") {
        return {
          role: "user",
          content: `[A staff member replied to the guest]: ${m.content}`,
        };
      }
      if (m.role === "system") {
        return { role: "user", content: `[conversation note]: ${m.content}` };
      }
      return { role: "user", content: m.content };
    });

  const [{ data: customActions }, { data: property }] = await Promise.all([
    supabase
      .from("chatbot_custom_actions")
      .select("*")
      .eq("chatbot_id", bot.id)
      .eq("enabled", true),
    supabase.from("properties").select("name").eq("id", bot.property_id).maybeSingle(),
  ]);
  const tools = buildGuestBotTools(
    {
      propertyId: bot.property_id,
      chatbotId: bot.id,
      chatbotName: bot.name,
      conversationId: conversation.id,
      sandbox: false,
    },
    config,
    customActions ?? [],
  );

  try {
    const result = runGuestBot({
      config,
      propertyName: property?.name ?? "this property",
      guest: {
        guestName: conversation.guest_name,
        roomNumber: conversation.room_number,
      },
      tools,
      messages,
      sessionCapReached,
      onFinish: async ({ text: reply, totalTokens, toolCalls, attachments }) => {
        const finished = new Date().toISOString();
        await supabase.from("chatbot_messages").insert({
          conversation_id: conversation.id,
          property_id: bot.property_id,
          role: "bot",
          content: reply || "(no reply)",
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          attachments: attachments.length > 0 ? attachments : null,
          tokens: totalTokens,
          created_at: finished,
        });
        await supabase
          .from("chatbot_conversations")
          .update({
            message_count: conversation.message_count + 2,
            last_message_at: finished,
          })
          .eq("id", conversation.id);
        await recordUsage({
          chatbotId: bot.id,
          propertyId: bot.property_id,
          tokens: totalTokens ?? 0,
        });
      },
    });
    return result.toTextStreamResponse();
  } catch (err) {
    console.error("[guest-messages] generation failed", err);
    return NextResponse.json({
      state: "error",
      reply: config.guardrails.fallbackMessage,
    });
  }
}
