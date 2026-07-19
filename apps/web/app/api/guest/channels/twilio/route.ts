import { type NextRequest } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parseChatbotConfig } from "@/lib/chatbots/schema";
import { checkDailyBudget, checkGuestRateLimits, recordUsage } from "@/lib/chatbots/limits";
import {
  sendTwilioMessage,
  twilioSendConfigured,
  twimlReply,
  validateTwilioSignature,
} from "@/lib/chatbots/twilio";
import { runGuestBot } from "@/lib/ai/guest-bot/run-guest-bot";
import { loadGuestProfile } from "@/lib/brain/guest-profile";
import { buildGuestBotTools } from "@/lib/ai/guest-bot/tools/registry";
import type { ModelMessage } from "ai";

/**
 * Twilio incoming-message webhook — the WhatsApp/SMS channel. One webhook
 * serves every bot: the `To` number routes to the chatbot whose
 * `twilio_number` matches, and the guest's `From` number IS the session
 * (conversation continuity for free; same pipeline, tools, budgets, and
 * escalation as the web channel).
 *
 * Reply transport adapts to what's configured:
 *   • TWILIO_ACCOUNT_SID + AUTH_TOKEN set → ack the webhook empty and send
 *     the reply via REST from after() (no 15s webhook-timeout pressure)
 *   • not set → generate inline and reply as synchronous TwiML
 */

export const maxDuration = 60;

const HISTORY_WINDOW = 30;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  if (
    !validateTwilioSignature(
      request.url,
      params,
      request.headers.get("x-twilio-signature"),
    )
  ) {
    return new Response("invalid signature", { status: 403 });
  }

  const from = params.From ?? "";
  const to = params.To ?? "";
  const text = (params.Body ?? "").trim().slice(0, 2000);
  if (!from || !to || !text) return twimlReply(null);

  const supabase = createServiceClient();
  const { data: bot } = await supabase
    .from("chatbots")
    .select(
      "id, property_id, name, status, config, daily_message_cap, session_message_cap, twilio_number",
    )
    .eq("twilio_number", to)
    .is("archived_at", null)
    .maybeSingle();
  if (!bot || bot.status !== "published") return twimlReply(null);

  const config = parseChatbotConfig(bot.config);
  const channel = from.startsWith("whatsapp:") ? "whatsapp" : "sms";

  // Find-or-create the conversation keyed by the guest's number.
  let { data: convo } = await supabase
    .from("chatbot_conversations")
    .select("id, status, guest_name, room_number, message_count")
    .eq("chatbot_id", bot.id)
    .eq("session_token", from)
    .maybeSingle();
  if (!convo) {
    const { data: created } = await supabase
      .from("chatbot_conversations")
      .insert({
        chatbot_id: bot.id,
        property_id: bot.property_id,
        session_token: from,
        channel,
        guest_phone: from.replace(/^whatsapp:/, ""),
      })
      .select("id, status, guest_name, room_number, message_count")
      .single();
    if (!created) return twimlReply(null);
    convo = created;
  }

  const rate = await checkGuestRateLimits({
    conversationId: convo.id,
    chatbotId: bot.id,
    ip: from, // the phone number is the natural abuse key on this channel
  });
  if (!rate.ok) return twimlReply(rate.reason);

  const now = new Date().toISOString();
  await supabase.from("chatbot_messages").insert({
    conversation_id: convo.id,
    property_id: bot.property_id,
    role: "guest",
    content: text,
    created_at: now,
  });
  await supabase
    .from("chatbot_conversations")
    .update({ message_count: convo.message_count + 1, last_message_at: now })
    .eq("id", convo.id);

  // Human owns it — store the message (staff see it via Realtime), stay quiet.
  if (convo.status === "human") return twimlReply(null);

  const budget = await checkDailyBudget({
    chatbotId: bot.id,
    dailyCap: bot.daily_message_cap,
  });
  if (!budget.ok) return twimlReply(config.guardrails.fallbackMessage);

  const { count: guestCount } = await supabase
    .from("chatbot_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", convo.id)
    .eq("role", "guest");
  if ((guestCount ?? 0) > bot.session_message_cap + 5) {
    return twimlReply(config.guardrails.fallbackMessage);
  }

  const [{ data: history }, { data: customActions }, { data: property }] =
    await Promise.all([
      supabase
        .from("chatbot_messages")
        .select("role, content")
        .eq("conversation_id", convo.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_WINDOW),
      supabase
        .from("chatbot_custom_actions")
        .select("*")
        .eq("chatbot_id", bot.id)
        .eq("enabled", true),
      supabase.from("properties").select("name").eq("id", bot.property_id).maybeSingle(),
    ]);

  const messages: ModelMessage[] = (history ?? [])
    .reverse()
    .map((m): ModelMessage => {
      if (m.role === "bot") return { role: "assistant", content: m.content };
      if (m.role === "staff") {
        return { role: "user", content: `[A staff member replied to the guest]: ${m.content}` };
      }
      if (m.role === "system") {
        return { role: "user", content: `[conversation note]: ${m.content}` };
      }
      return { role: "user", content: m.content };
    });

  const tools = buildGuestBotTools(
    {
      propertyId: bot.property_id,
      chatbotId: bot.id,
      chatbotName: bot.name,
      conversationId: convo.id,
      sandbox: false,
    },
    config,
    customActions ?? [],
  );

  const generate = async (): Promise<string> => {
    const result = runGuestBot({
      config,
      propertyName: property?.name ?? "this property",
      guest: {
        guestName: convo.guest_name,
        roomNumber: convo.room_number,
        // The guest's From number IS the session — the strongest identity
        // we have; profile pages are keyed by its hash.
        profileNotes: await loadGuestProfile(bot.property_id, {
          phone: from.replace(/^whatsapp:/, ""),
        }),
      },
      tools,
      messages,
      sessionCapReached: (guestCount ?? 0) >= bot.session_message_cap,
      onFinish: async ({ text: reply, totalTokens, toolCalls }) => {
        const finished = new Date().toISOString();
        await supabase.from("chatbot_messages").insert({
          conversation_id: convo.id,
          property_id: bot.property_id,
          role: "bot",
          content: reply || "(no reply)",
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          tokens: totalTokens,
          created_at: finished,
        });
        await supabase
          .from("chatbot_conversations")
          .update({ message_count: convo.message_count + 2, last_message_at: finished })
          .eq("id", convo.id);
        await recordUsage({
          chatbotId: bot.id,
          propertyId: bot.property_id,
          tokens: totalTokens ?? 0,
        });
      },
    });
    return (await result.text).trim();
  };

  try {
    if (twilioSendConfigured() && bot.twilio_number) {
      // Ack now, reply out-of-band — webhooks time out at ~15s and tool
      // chains can exceed it.
      after(async () => {
        try {
          const reply = await generate();
          if (reply) {
            await sendTwilioMessage({ to: from, from: bot.twilio_number!, body: reply });
          }
        } catch (err) {
          console.error("[twilio-webhook] deferred generation failed", err);
        }
      });
      return twimlReply(null);
    }
    const reply = await generate();
    return twimlReply(reply || config.guardrails.fallbackMessage);
  } catch (err) {
    console.error("[twilio-webhook] generation failed", err);
    return twimlReply(config.guardrails.fallbackMessage);
  }
}
