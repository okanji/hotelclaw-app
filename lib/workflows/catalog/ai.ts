import { z } from "zod";
import { explainTemplateValue } from "@/lib/workflows/explain-template";
import { type StepCatalogEntry } from "./types";

function explainInput(config: unknown, verb: string): string {
  const c = config as { input?: string };
  const src = explainTemplateValue(c.input);
  return src ? `${verb} ${src}` : verb;
}

// All AI steps route through runBot() in lib/ai/run-bot.ts. The classify /
// extract / branch_decision variants inject an emit_* tool with a Zod schema
// and instruct the model to call it. This keeps gbrain auto-injection, model
// settings, and step-count guards uniform across Tier 1.

const actions: StepCatalogEntry[] = [
  {
    id: "ai.summarize_text",
    surface: "ai",
    category: "ai",
    label: "Summarize text",
    description:
      "Writes a short summary of the text you give it. You choose the length — short, medium, or long. Later steps can use the summary.",
    examplePrompts: [
      "summarize the complaint",
      "give me a short summary of the message",
    ],
    outputSchema: z.object({ summary: z.string() }),
    explain: (config) => explainInput(config, "Summarize"),
  },
  {
    id: "ai.classify_into",
    surface: "ai",
    category: "ai",
    label: "Classify into labels",
    description:
      "Sorts the input into exactly one of the labels you list — great for routing (e.g. low / medium / high). Also returns how confident it was and why.",
    examplePrompts: [
      "classify the complaint severity (low/med/high)",
      "is this message urgent, normal, or spam?",
    ],
    outputSchema: z.object({
      label: z.string(),
      confidence: z.number(),
      reasoning: z.string(),
    }),
    explain: (config) => {
      const c = config as { labels?: string[]; input?: string };
      const labels = (c.labels ?? []).join(" / ");
      const src = explainTemplateValue(c.input);
      return src
        ? `Classify ${src} as ${labels || "…"}`
        : `Classify into ${labels || "…"}`;
    },
  },
  {
    id: "ai.extract_fields",
    surface: "ai",
    category: "ai",
    label: "Extract details into fields",
    description:
      "Pulls specific details out of the text into named fields you define — e.g. room number and issue from a complaint — so later steps can use them.",
    examplePrompts: [
      "extract the room number and issue from this complaint",
      "pull guest name and arrival date out of the message",
    ],
    outputSchema: z.object({
      fields: z.record(z.string(), z.unknown()),
    }),
    explain: (config) => explainInput(config, "Extract fields from"),
  },
  {
    id: "ai.draft_reply",
    surface: "ai",
    category: "ai",
    label: "Draft a reply",
    description:
      "Writes reply text in the tone you choose. It only drafts — add a “Post message” step after it to actually send the reply.",
    examplePrompts: [
      "draft a warm reply to the guest",
      "write an apology to the complainer",
    ],
    outputSchema: z.object({ text: z.string() }),
    explain: (config) => {
      const c = config as { tone?: string; input?: string };
      const src = explainTemplateValue(c.input);
      const tone = c.tone ?? "warm";
      return src ? `Draft a ${tone} reply to ${src}` : `Draft a ${tone} reply`;
    },
  },
  {
    id: "ai.branch_decision",
    surface: "ai",
    category: "ai",
    label: "Make a yes/no decision",
    description:
      "Ask the AI a yes/no question about the input. The workflow then takes the “yes” path or the “no” path based on its answer.",
    examplePrompts: [
      "is this a real complaint or just feedback?",
      "should the GM be paged for this?",
    ],
    outputSchema: z.object({ decision: z.enum(["true", "false"]), reasoning: z.string() }),
    explain: (config) => {
      const c = config as { question?: string };
      return c.question ? `AI decides: ${c.question}` : "AI yes/no decision";
    },
  },
  {
    id: "ai.freeform",
    surface: "ai",
    category: "ai",
    label: "Custom AI task",
    description:
      "A flexible AI step with its own instructions and access to tools. Reach for this when summarize, classify, or draft don't fit — e.g. multi-step reasoning that looks things up.",
    examplePrompts: [
      "investigate the issue and propose a fix",
      "look up similar past complaints and suggest an action",
    ],
    outputSchema: z.object({ text: z.string() }),
    explain: () => "Custom AI task",
  },
];

export const AI_ACTIONS = actions;
