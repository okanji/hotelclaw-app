import { z } from "zod";
import { type StepCatalogEntry } from "./types";

// All AI steps route through runBot() in lib/ai/run-bot.ts. The classify /
// extract / branch_decision variants inject an emit_* tool with a Zod schema
// and instruct the model to call it. This keeps gbrain auto-injection, model
// settings, and step-count guards uniform across Tier 1.

const actions: StepCatalogEntry[] = [
  {
    id: "ai.summarize_text",
    surface: "ai",
    category: "ai",
    label: "AI: summarize text",
    description:
      "Generate a concise summary of an input string. `length` controls verbosity (short ~25 words, medium ~75, long ~200). Returns {{steps.<id>.output.summary}}.",
    examplePrompts: [
      "summarize the complaint",
      "give me a short summary of the message",
    ],
    outputSchema: z.object({ summary: z.string() }),
    explain: () => "AI summarizes text",
  },
  {
    id: "ai.classify_into",
    surface: "ai",
    category: "ai",
    label: "AI: classify into one of N labels",
    description:
      "Classify an input into exactly one of the provided labels. Returns {{steps.<id>.output.label}} (one of `labels`), `confidence` (0-1), and `reasoning`. Routes downstream via control.branch_switch on the label.",
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
      const c = config as { labels?: string[] };
      return `AI classifies into ${(c.labels ?? []).join(" / ")}`;
    },
  },
  {
    id: "ai.extract_fields",
    surface: "ai",
    category: "ai",
    label: "AI: extract structured fields",
    description:
      "Extract typed fields from an input string. Each entry in `fields` declares a name, type (string/number/boolean/string[]), description, and required flag. Returns the extracted object at {{steps.<id>.output.fields}}.",
    examplePrompts: [
      "extract the room number and issue from this complaint",
      "pull guest name and arrival date out of the message",
    ],
    outputSchema: z.object({
      fields: z.record(z.string(), z.unknown()),
    }),
    explain: () => "AI extracts structured fields",
  },
  {
    id: "ai.draft_reply",
    surface: "ai",
    category: "ai",
    label: "AI: draft a reply",
    description:
      "Generate a reply text in a chosen tone (formal/warm/concise/apologetic/celebratory). Does NOT post the reply — chain a `post_message` step to actually send it. Returns {{steps.<id>.output.text}}.",
    examplePrompts: [
      "draft a warm reply to the guest",
      "write an apology to the complainer",
    ],
    outputSchema: z.object({ text: z.string() }),
    explain: (config) => {
      const c = config as { tone?: string };
      return `AI drafts a ${c.tone ?? "warm"} reply`;
    },
  },
  {
    id: "ai.branch_decision",
    surface: "ai",
    category: "ai",
    label: "AI: branch on a yes/no decision",
    description:
      "Ask the AI a yes/no question about the input. Routes downstream into the `branches.true` or `branches.false` step.",
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
    label: "AI: freeform agent",
    description:
      "Full runBot() invocation with a custom persona, scoped tools, and up to `max_steps` tool turns. Use when classify/extract/draft don't fit — e.g. multi-step reasoning that pulls from gbrain.",
    examplePrompts: [
      "investigate the issue and propose a fix",
      "look up similar past complaints and suggest an action",
    ],
    outputSchema: z.object({ text: z.string() }),
    explain: () => "AI freeform agent",
  },
];

export const AI_ACTIONS = actions;
