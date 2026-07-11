import "server-only";
import { z } from "zod";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  ChatbotConfigZod,
  newTicketFieldId,
  type ChatbotConfig,
} from "@/lib/chatbots/schema";

/**
 * Shared "describe it → ChatbotConfig" generator. Used by the builder's
 * AI-draft route (/chatbots/generate) and the onboarding chatbot workflow.
 * The model writes instructions/actions/labels only; ids (ticket fields) are
 * assigned server-side, and channel/space targets stay empty for the
 * builder's pickers.
 */

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

export const GeneratedChatbotZod = z.object({
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
        fields: z
          .array(
            z.object({ label: z.string().min(1).max(80), required: z.boolean() }),
          )
          .max(6),
      })
      .nullable(),
    escalateToHuman: z.object({ whenToUse: z.string().max(400) }).nullable(),
  }),
});

export type GeneratedChatbot = z.infer<typeof GeneratedChatbotZod>;

const SYSTEM = [
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
].join("\n");

/** Map the model's draft into a validated persisted ChatbotConfig. Exported
 *  for the route; throws ZodError if the mapped config is invalid. */
export function mapGeneratedToConfig(generated: GeneratedChatbot): ChatbotConfig {
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

  return ChatbotConfigZod.parse({
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
}

/**
 * Generate a full chatbot draft from a natural-language description.
 * Throws when ANTHROPIC_API_KEY is missing, the model call fails, or the
 * mapped config doesn't validate — callers decide the fallback.
 */
export async function generateChatbotDraft(description: string): Promise<{
  config: ChatbotConfig;
  knowledgeChecklist: string[];
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("AI not configured (ANTHROPIC_API_KEY missing)");
  }
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await generateText({
    model: anthropic(GENERATE_MODEL),
    output: Output.object({ schema: GeneratedChatbotZod }),
    temperature: 0,
    maxRetries: 3,
    system: SYSTEM,
    prompt: description,
  });
  return {
    config: mapGeneratedToConfig(result.output),
    knowledgeChecklist: result.output.knowledgeChecklist,
  };
}
