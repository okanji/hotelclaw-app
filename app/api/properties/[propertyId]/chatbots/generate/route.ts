import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  ChatbotConfigZod,
  newTicketFieldId,
  type ChatbotConfig,
} from "@/lib/chatbots/schema";

// POST /api/properties/:propertyId/chatbots/generate — describe a chatbot in
// plain language, get back a validated ChatbotConfig draft (forms/generate
// pattern). The model writes instructions/actions/labels only; ids (ticket
// fields) are assigned server-side, and channel/space targets stay empty for
// the builder's pickers.

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

const Body = z.object({ description: z.string().trim().min(1).max(2000) });

const GeneratedChatbot = z.object({
  displayName: z.string().min(1).max(60),
  avatarEmoji: z.string().min(1).max(8),
  instructions: z.string().min(1).max(4000),
  greeting: z.string().min(1).max(300),
  suggestedQuestions: z.array(z.string().min(1).max(120)).max(4),
  modelTier: z.enum(["standard", "advanced"]),
  onlyFromSources: z.boolean(),
  knowledgeChecklist: z.array(z.string().min(1).max(160)).max(8),
  actions: z.object({
    answerFromKnowledge: z.boolean(),
    collectGuestInfo: z
      .object({
        whenToUse: z.string().max(400),
        name: z.boolean(),
        email: z.boolean(),
        phone: z.boolean(),
        room: z.boolean(),
      })
      .nullable(),
    createTicket: z
      .object({
        whenToUse: z.string().max(400),
        kind: z.enum(["order", "request", "maintenance"]),
        priority: z.enum(["low", "medium", "high", "urgent"]),
        fields: z.array(z.object({ label: z.string().min(1).max(80), required: z.boolean() })).max(6),
      })
      .nullable(),
    escalateToHuman: z
      .object({ whenToUse: z.string().max(400) })
      .nullable(),
  }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let generated: z.infer<typeof GeneratedChatbot>;
  try {
    const result = await generateText({
      model: anthropic(GENERATE_MODEL),
      output: Output.object({ schema: GeneratedChatbot }),
      temperature: 0,
      maxRetries: 3,
      system: [
        "You design guest-facing AI chatbots for hotels and restaurants. Staff describe the bot they need; you draft its full configuration.",
        "Rules:",
        "- `instructions` is the bot's system prompt: who it is, what it helps guests with, its tone (warm, brief, professional), and what it must not do. 2-4 short paragraphs. Write in second person ('You are…').",
        "- Enable `createTicket` whenever the bot takes orders or requests staff must act on; pick the kind (order/request/maintenance) and 2-4 ticket fields staff need (e.g. 'Items ordered', 'Room number').",
        "- Enable `collectGuestInfo` when staff need to find or contact the guest; only the fields that matter.",
        "- Almost always enable `escalateToHuman` — guests must be able to reach a person. Write its whenToUse for complaints, billing, safety, and explicit asks.",
        "- `whenToUse` strings are trigger guidance for the bot, e.g. 'When the guest has confirmed their order.'",
        "- `onlyFromSources` true when wrong answers are costly (menus, prices, policies).",
        "- `modelTier`: 'advanced' for bots that take multi-step orders, 'standard' for FAQ bots.",
        "- `knowledgeChecklist`: what staff should add to the knowledge base before publishing.",
        "- `suggestedQuestions`: up to 4 short tappable starters a guest would actually ask.",
        "- `greeting`: one friendly opening line. `avatarEmoji`: one fitting emoji.",
      ].join("\n"),
      prompt: body.description,
    });
    generated = result.output;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 500 },
    );
  }

  const actions: ChatbotConfig["actions"] = [];
  if (generated.actions.answerFromKnowledge) {
    actions.push({ type: "answer_from_knowledge", enabled: true });
  }
  if (generated.actions.collectGuestInfo) {
    const g = generated.actions.collectGuestInfo;
    actions.push({
      type: "collect_guest_info",
      enabled: true,
      whenToUse: g.whenToUse,
      config: { name: g.name, email: g.email, phone: g.phone, room: g.room },
    });
  }
  if (generated.actions.createTicket) {
    const t = generated.actions.createTicket;
    actions.push({
      type: "create_ticket",
      enabled: true,
      whenToUse: t.whenToUse,
      config: {
        kind: t.kind,
        priority: t.priority,
        fields: t.fields.map((f) => ({
          id: newTicketFieldId(),
          label: f.label,
          required: f.required,
        })),
      },
    });
  }
  if (generated.actions.escalateToHuman) {
    actions.push({
      type: "escalate_to_human",
      enabled: true,
      whenToUse: generated.actions.escalateToHuman.whenToUse,
      config: { notifyRoles: ["owner", "manager"] },
    });
  }

  let config: ChatbotConfig;
  try {
    config = ChatbotConfigZod.parse({
      version: 1,
      instructions: generated.instructions,
      modelTier: generated.modelTier,
      greeting: generated.greeting,
      suggestedQuestions: generated.suggestedQuestions,
      appearance: {
        displayName: generated.displayName,
        avatarEmoji: generated.avatarEmoji,
        theme: "warm",
      },
      guardrails: { onlyFromSources: generated.onlyFromSources },
      actions,
    });
  } catch {
    return NextResponse.json(
      { error: "generated config was invalid" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    config,
    knowledgeChecklist: generated.knowledgeChecklist,
  });
}
