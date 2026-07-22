import "server-only";
import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  AGENT_TOOL_CATALOG,
  AgentConfigZod,
  type AgentConfig,
} from "@/lib/agents/schema";

/**
 * Conversational agent builder (the ClickUp-style flow the PO demoed):
 * describe the agent in plain language; the model asks AT MOST one focused
 * clarifying question per turn (a couple max), then returns a complete
 * config draft. Multi-turn — the dialog feeds the whole exchange back in.
 *
 * Same generation discipline as lib/chatbots/generate.ts: the model writes
 * text (instructions, name, prompts) and picks from a FIXED tool-id list;
 * everything is validated against AgentConfigZod before it reaches the DB.
 */

const GENERATE_MODEL = "claude-haiku-4-5-20251001";

const TOOL_IDS = AGENT_TOOL_CATALOG.map((t) => t.id);

const GeneratedAgentZod = z.object({
  /** Ask exactly one clarifying question instead of drafting. */
  question: z.string().max(300).nullable(),
  draft: z
    .object({
      name: z.string().min(1).max(80),
      description: z.string().max(300),
      avatarEmoji: z.string().max(8),
      instructions: z.string().min(1).max(8000),
      modelTier: z.enum(["standard", "advanced"]),
      tools: z.array(z.enum(TOOL_IDS as [string, ...string[]])).max(12),
      starterPrompts: z.array(z.string().max(200)).max(4),
    })
    .nullable(),
});

export type BuilderTurn = { role: "user" | "assistant"; content: string };

export type BuilderResult =
  | { kind: "question"; question: string }
  | { kind: "draft"; name: string; config: AgentConfig };

const SYSTEM = [
  "You help hotel staff design an internal AI agent (a durable assistant with tool access) from a plain-language description.",
  "",
  "Available tool grants (grant ONLY what the described job needs):",
  ...AGENT_TOOL_CATALOG.map((t) => `- ${t.id} (${t.category}): ${t.summary}`),
  "",
  "Rules:",
  "- If something load-bearing is missing or ambiguous (what it should monitor, who it serves, whether it may create things), ask ONE short clarifying question via `question` and set draft to null.",
  "- Ask at most TWO questions across the whole conversation — after that, draft with sensible assumptions.",
  "- When drafting: set question to null and fill draft completely.",
  "- `instructions` is the agent's system prompt: write it in second person, concrete and operational — role, what to watch, how to report (brief, concrete, no fluff), when to use each granted tool, and any mappings the user gave (e.g. status → responsible person) verbatim.",
  "- `modelTier`: 'advanced' only for judgment-heavy monitoring/reporting agents; 'standard' for simple lookups.",
  "- `starterPrompts`: 2-4 things the user would actually click, matching the agent's job.",
  "- `avatarEmoji`: one fitting emoji.",
].join("\n");

export async function generateAgentDraft(
  turns: BuilderTurn[],
): Promise<BuilderResult> {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await generateText({
    model: anthropic(GENERATE_MODEL),
    output: Output.object({ schema: GeneratedAgentZod }),
    system: SYSTEM,
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
    temperature: 0.3,
  });

  const generated = result.output;
  if (generated.question && !generated.draft) {
    return { kind: "question", question: generated.question };
  }
  if (!generated.draft) {
    throw new Error("The model returned neither a question nor a draft");
  }

  const config = AgentConfigZod.parse({
    version: 1,
    description: generated.draft.description,
    avatarEmoji: generated.draft.avatarEmoji || "🤖",
    instructions: generated.draft.instructions,
    modelTier: generated.draft.modelTier,
    tools: generated.draft.tools,
    starterPrompts: generated.draft.starterPrompts,
  });
  return { kind: "draft", name: generated.draft.name, config };
}
