import "server-only";
import { runBot, tool, z, type ToolSet } from "@/lib/ai/run-bot";
import type { RunnerImpl } from "./types";

// Every AI step runs through runBot() — uniform model settings, gbrain auto-
// injection, and step-count guards. For structured-output variants we inject
// an `emit_*` tool whose Zod schema constrains the model's output; the tool's
// execute() captures the args into a closure we read after runBot returns.
//
// This preserves Tier 1 uniformity (no parallel generateObject path) at the
// cost of one extra round-trip vs. native structured output. Acceptable for v1.

function botScopeFor(ctx: { propertyId: string; workflowOwnerId: string }) {
  return {
    propertyId: ctx.propertyId,
    userId: ctx.workflowOwnerId,
    surface: "workflow-step" as const,
  };
}

// ─── ai.summarize_text ───────────────────────────────────────────────────────

type SummarizeConfig = {
  input: string;
  length?: "short" | "medium" | "long";
  persona_hint?: string;
};

export const aiSummarizeRunner: RunnerImpl<SummarizeConfig, { summary: string }> = async ({
  config,
  ctx,
}) => {
  if (ctx.dryRun) return { summary: "(dry-run summary)" };
  const wordTarget =
    config.length === "short" ? 25 : config.length === "long" ? 200 : 75;
  const personaParts = [
    "You write concise, neutral-tone summaries of text for a hotel operations team.",
    config.persona_hint,
  ].filter(Boolean) as string[];
  const result = await runBot({
    persona: personaParts.join(" "),
    activationReason: "mention",
    scopedTools: {},
    messages: [
      {
        role: "user",
        content: `Summarize the following in about ${wordTarget} words. Reply with only the summary text, no preamble.\n\n${config.input}`,
      },
    ],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  return { summary: result.text };
};

// ─── ai.classify_into ────────────────────────────────────────────────────────

type ClassifyConfig = {
  input: string;
  labels: string[];
  persona_hint?: string;
};

type ClassifyOutput = {
  label: string;
  confidence: number;
  reasoning: string;
};

export const aiClassifyRunner: RunnerImpl<ClassifyConfig, ClassifyOutput> = async ({
  config,
  ctx,
}) => {
  if (ctx.dryRun) {
    return { label: config.labels[0], confidence: 0.5, reasoning: "(dry-run)" };
  }
  let captured: ClassifyOutput | null = null;
  const labels = config.labels as [string, ...string[]];
  const tools: ToolSet = {
    emit_classification: tool({
      description:
        "Emit your final classification. Call this exactly once with the chosen label, confidence (0-1), and one-sentence reasoning.",
      inputSchema: z.object({
        label: z.enum(labels),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().min(1),
      }),
      execute: async (args) => {
        captured = args;
        return { ok: true };
      },
    }),
  };
  const result = await runBot({
    persona: [
      "You classify a single input into exactly one of the provided labels.",
      "Call `emit_classification` with your choice. Pick the closest label even when none is perfect — confidence reflects fit.",
      config.persona_hint,
    ]
      .filter(Boolean)
      .join(" "),
    activationReason: "auto-classifier",
    scopedTools: tools,
    messages: [
      {
        role: "user",
        content: `Labels: ${config.labels.join(", ")}\n\nInput:\n${config.input}`,
      },
    ],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  if (!captured) {
    throw new Error("ai.classify_into: model did not call emit_classification");
  }
  return captured;
};

// ─── ai.extract_fields ───────────────────────────────────────────────────────

type FieldSpec = {
  type: "string" | "number" | "boolean" | "string[]";
  description?: string;
  required?: boolean;
};

type ExtractConfig = {
  input: string;
  fields: Record<string, FieldSpec>;
  persona_hint?: string;
};

function zodFromFieldType(spec: FieldSpec): z.ZodTypeAny {
  switch (spec.type) {
    case "string":
      return spec.description ? z.string().describe(spec.description) : z.string();
    case "number":
      return spec.description ? z.number().describe(spec.description) : z.number();
    case "boolean":
      return spec.description ? z.boolean().describe(spec.description) : z.boolean();
    case "string[]":
      return spec.description ? z.array(z.string()).describe(spec.description) : z.array(z.string());
  }
}

export const aiExtractRunner: RunnerImpl<
  ExtractConfig,
  { fields: Record<string, unknown> }
> = async ({ config, ctx }) => {
  if (ctx.dryRun) {
    return { fields: Object.fromEntries(Object.keys(config.fields).map((k) => [k, null])) };
  }
  let captured: Record<string, unknown> | null = null;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(config.fields)) {
    const base = zodFromFieldType(spec);
    shape[key] = spec.required ? base : base.nullable().optional();
  }
  const tools: ToolSet = {
    emit_extraction: tool({
      description:
        "Emit the extracted fields. Call this exactly once with the values you find. Use null for genuinely absent fields — never hallucinate.",
      inputSchema: z.object(shape),
      execute: async (args) => {
        captured = args;
        return { ok: true };
      },
    }),
  };
  const result = await runBot({
    persona: [
      "You extract structured fields from an input. Be literal — only emit what the input states or directly implies.",
      config.persona_hint,
    ]
      .filter(Boolean)
      .join(" "),
    activationReason: "auto-classifier",
    scopedTools: tools,
    messages: [{ role: "user", content: config.input }],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  if (!captured) {
    throw new Error("ai.extract_fields: model did not call emit_extraction");
  }
  return { fields: captured };
};

// ─── ai.draft_reply ──────────────────────────────────────────────────────────

type DraftReplyConfig = {
  input: string;
  tone?: "formal" | "warm" | "concise" | "apologetic" | "celebratory";
  persona_hint?: string;
};

export const aiDraftReplyRunner: RunnerImpl<DraftReplyConfig, { text: string }> = async ({
  config,
  ctx,
}) => {
  if (ctx.dryRun) return { text: "(dry-run draft)" };
  const tone = config.tone ?? "warm";
  const toneNote: Record<typeof tone, string> = {
    formal: "Use formal, professional language. No contractions.",
    warm: "Warm and friendly, but professional.",
    concise: "As brief as possible. Get straight to the point.",
    apologetic: "Lead with a genuine apology. Acknowledge the issue clearly.",
    celebratory: "Celebrate the moment. Be upbeat and specific.",
  };
  const result = await runBot({
    persona: [
      "You draft replies for a hotel team. You do NOT send them — your output is the draft text only.",
      toneNote[tone],
      config.persona_hint,
    ]
      .filter(Boolean)
      .join(" "),
    activationReason: "mention",
    scopedTools: {},
    messages: [
      {
        role: "user",
        content: `Draft a reply to the following. Reply with ONLY the draft text, no preamble.\n\n${config.input}`,
      },
    ],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  return { text: result.text };
};

// ─── ai.branch_decision ──────────────────────────────────────────────────────

type BranchDecisionConfig = {
  input: string;
  question: string;
  persona_hint?: string;
};

type BranchDecisionOutput = { decision: "true" | "false"; reasoning: string };

export const aiBranchDecisionRunner: RunnerImpl<
  BranchDecisionConfig,
  BranchDecisionOutput
> = async ({ config, ctx }) => {
  if (ctx.dryRun) return { decision: "true", reasoning: "(dry-run)" };
  let captured: BranchDecisionOutput | null = null;
  const tools: ToolSet = {
    emit_decision: tool({
      description:
        "Emit your yes/no decision. Call this exactly once.",
      inputSchema: z.object({
        decision: z.enum(["true", "false"]),
        reasoning: z.string().min(1),
      }),
      execute: async (args) => {
        captured = args;
        return { ok: true };
      },
    }),
  };
  const result = await runBot({
    persona: [
      "You answer a single yes/no question about an input and call `emit_decision`.",
      config.persona_hint,
    ]
      .filter(Boolean)
      .join(" "),
    activationReason: "auto-classifier",
    scopedTools: tools,
    messages: [
      {
        role: "user",
        content: `Question: ${config.question}\n\nInput:\n${config.input}`,
      },
    ],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  if (!captured) {
    throw new Error("ai.branch_decision: model did not call emit_decision");
  }
  return captured;
};

// ─── ai.freeform ─────────────────────────────────────────────────────────────

type FreeformConfig = {
  persona: string;
  input: string;
  tools?: string[];
  max_steps?: number;
};

export const aiFreeformRunner: RunnerImpl<FreeformConfig, { text: string }> = async ({
  config,
  ctx,
}) => {
  if (ctx.dryRun) return { text: "(dry-run freeform)" };
  // Tool subsetting is deferred — v1 freeform agents get the runtime's default
  // tool surface (gbrain + delegate via runBot). When we wire surface-specific
  // tools (e.g. task tools, doc tools) we'll filter by config.tools here.
  const result = await runBot({
    persona: config.persona,
    activationReason: "mention",
    scopedTools: {},
    messages: [{ role: "user", content: config.input }],
    scope: botScopeFor(ctx),
  });
  if (result.trace) ctx.recordTrace?.(result.trace);
  return { text: result.text };
};
