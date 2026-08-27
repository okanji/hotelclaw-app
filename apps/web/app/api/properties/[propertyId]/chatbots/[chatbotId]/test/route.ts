import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runGuestBot } from "@/lib/ai/guest-bot/run-guest-bot";
import { buildGuestBotTools } from "@/lib/ai/guest-bot/tools/registry";
import { parseChatbotConfig } from "@/lib/chatbots/schema";
import { cardsFromToolResults } from "@/lib/chatbots/cards";

/**
 * POST /api/properties/:propertyId/chatbots/:chatbotId/test
 *
 * Builder test console: one bot turn through the REAL guest runtime
 * (same system prompt, same tools, same model) but in sandbox mode —
 * side-effecting tools simulate ("would create ticket X") instead of
 * writing; knowledge search runs live so sources can be verified.
 *
 * The client owns the message array (task-bot pattern, non-streaming).
 * A per-user `channel:'test'` conversation row backs the guest-details
 * tools so collect → ticket flows behave like production.
 */

export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1)
    .max(60),
  /** Playground compare: per-pane tweaks tried WITHOUT saving the config. */
  override: z
    .object({
      modelTier: z.enum(["standard", "advanced"]).optional(),
      instructions: z.string().max(8000).optional(),
      onlyFromSources: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; chatbotId: string }> },
) {
  const { propertyId, chatbotId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: bot } = await supabase
    .from("chatbots")
    .select("id, name, config, property_id, session_message_cap")
    .eq("id", chatbotId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!bot) return NextResponse.json({ error: "chatbot not found" }, { status: 404 });

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

  // Per-user test conversation — backs save_guest_details/loadGuest so the
  // console exercises real collect→ticket flows. Reset by deleting the row.
  const service = createServiceClient();
  const sessionToken = `test-${user.id}`;
  let { data: convo } = await service
    .from("chatbot_conversations")
    .select("id, guest_name, room_number")
    .eq("chatbot_id", chatbotId)
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!convo) {
    const { data: created, error } = await service
      .from("chatbot_conversations")
      .insert({
        chatbot_id: chatbotId,
        property_id: propertyId,
        session_token: sessionToken,
        channel: "test",
      })
      .select("id, guest_name, room_number")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: "couldn't start test session" }, { status: 500 });
    }
    convo = created;
  }

  const saved = parseChatbotConfig(bot.config);
  const o = parsed.data.override;
  const config = o
    ? {
        ...saved,
        ...(o.modelTier ? { modelTier: o.modelTier } : {}),
        ...(o.instructions !== undefined ? { instructions: o.instructions } : {}),
        guardrails: {
          ...saved.guardrails,
          ...(o.onlyFromSources !== undefined
            ? { onlyFromSources: o.onlyFromSources }
            : {}),
        },
      }
    : saved;
  const [{ data: property }, { data: customActions }] = await Promise.all([
    supabase.from("properties").select("name").eq("id", propertyId).maybeSingle(),
    supabase
      .from("chatbot_custom_actions")
      .select("*")
      .eq("chatbot_id", chatbotId)
      .eq("enabled", true),
  ]);

  // Custom actions run live even in the sandbox — they're the property's
  // own API, which is what the console exists to verify.
  const tools = buildGuestBotTools(
    {
      propertyId,
      chatbotId,
      chatbotName: bot.name,
      conversationId: convo.id,
      sandbox: true,
    },
    config,
    customActions ?? [],
  );

  try {
    const result = runGuestBot({
      config,
      propertyName: property?.name ?? "this property",
      guest: { guestName: convo.guest_name, roomNumber: convo.room_number },
      tools,
      messages: parsed.data.messages,
      onFinish: () => {},
    });
    // Consume the stream server-side — the console is request/response.
    const text = await result.text;
    const steps = await result.steps;
    // Per-call `output` (matched by toolCallId) rides along so the sandbox
    // console can show what each tool returned — search_knowledge hits,
    // simulated side effects. Member-gated route; additive, so the shape
    // stays backward compatible.
    const toolCalls = steps.flatMap((step) => {
      const outputByCall = new Map<string, unknown>(
        step.toolResults.map((tr) => [tr.toolCallId, tr.output as unknown]),
      );
      return step.toolCalls.map((tc) => ({
        name: tc.toolName,
        input: tc.input,
        output: outputByCall.get(tc.toolCallId),
      }));
    });
    const attachments = cardsFromToolResults(
      steps.flatMap((step) =>
        step.toolResults.map((tr) => ({
          toolName: tr.toolName,
          output: tr.output,
        })),
      ),
    );
    return NextResponse.json({
      reply: text.trim() || "(no reply)",
      toolCalls,
      attachments,
    });
  } catch (err) {
    console.error("[chatbot-test] generation failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}

/** DELETE — reset the caller's test session (fresh guest, empty details). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; chatbotId: string }> },
) {
  const { propertyId, chatbotId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createServiceClient();
  await service
    .from("chatbot_conversations")
    .delete()
    .eq("chatbot_id", chatbotId)
    .eq("property_id", propertyId)
    .eq("session_token", `test-${user.id}`);
  return NextResponse.json({ ok: true });
}
