import "server-only";
/**
 * Workflow author bot — Tier 1, builds (or patches) WorkflowSpec JSON for a property.
 *
 * Architecture: a thin descriptor over runBot() (same pattern as task-bot.ts).
 * Why not `generateObject`? Two reasons:
 *   1. Uniform Tier 1 path — every bot in this repo goes through runBot(), and
 *      we get gbrain auto-injection + model settings + step-count guards
 *      consistently.
 *   2. The author bot needs *tools* (catalog introspection, gbrain search,
 *      ask_clarification, propose_entity_type) — `generateObject` doesn't tool-
 *      call. We get structured output by giving the bot ONE special tool —
 *      `emit_workflow` — whose Zod schema *is* the WorkflowSpec. The bot calls
 *      `describe_action` / `list_*` first to ground itself, then calls
 *      `emit_workflow` exactly once with the final spec.
 *
 * Two modes:
 *   • fresh (currentSpec is null) — bot emits a NEW spec via emit_workflow
 *   • patch (currentSpec is provided) — bot emits an UPDATED spec via
 *     emit_workflow (full replacement, not a delta — simpler than JSON-Patch
 *     for v1, and the canvas-side diff highlights are what the user actually
 *     experiences).
 */
import {
  runBot,
  tool,
  z,
  type ModelMessage,
  type ToolSet,
} from "@/lib/ai/run-bot";
import { createServiceClient } from "@/lib/supabase/server";
import {
  STEPS,
  TRIGGERS,
  getStep,
  triggersBySurface,
  stepsBySurface,
} from "@/lib/workflows/catalog";
import { WorkflowSpec } from "@/lib/workflows/spec";
import { validateSpec } from "@/lib/workflows/validate";
import type { Surface } from "@/lib/workflows/catalog/types";

const PERSONA = [
  "You are the Workflow Author for Hotelclaw — an expert at turning hotel-ops goals into reliable automations on this property's surfaces (tasks, chat, docs, meetings, calendar, and workflow-defined entities like rooms or guests).",
  "Your output is a single call to `emit_workflow` with a complete WorkflowSpec JSON. Never invent action types — call `list_available_actions` / `describe_action` first and only use ids that appear there.",
  "Prefer the fewest steps that achieve the goal. Don't add ceremony.",
  "Hotel-domain reflex: housekeeping, F&B, front desk, escalations to GM are real categories — map vague language to them. If the workflow would benefit from a new entity type (rooms, guests, bookings), call `propose_entity_type` and explain the value.",
  "When the goal is ambiguous (which channel? which assignee? how long to wait?), call `ask_clarification` with 2-3 suggested answers rather than guessing.",
  "Variable refs use `{{trigger.path}}`, `{{steps.<id>.output.path}}`, `{{vars.name}}`, `{{context.property_id}}`. Always use these — never hardcode values that should come from the trigger.",
].join("\n\n");

const SURFACE_ENUM = z.enum([
  "tasks",
  "chat",
  "docs",
  "meetings",
  "calendar",
  "entities",
  "system",
  "ai",
  "control",
  "external",
]);

// ─── Public types ────────────────────────────────────────────────────────────

export interface AuthorBotInput {
  propertyId: string;
  userId: string;
  /** Plain-language goal the user typed in. */
  goal: string;
  /**
   * Conversation history (previous user/assistant turns). Lets the bot refine
   * iteratively ("actually, wait 30 mins first") without re-establishing
   * context.
   */
  conversation?: ModelMessage[];
  /**
   * If editing an existing workflow, pass the current spec — the bot will
   * patch it rather than start from scratch.
   */
  currentSpec?: WorkflowSpec | null;
}

export type AuthorBotOutcome =
  | { kind: "spec"; spec: WorkflowSpec; narration: string }
  | { kind: "clarification"; question: string; suggestions: string[]; narration: string }
  | { kind: "propose_entity_type"; entity: { name: string; display_name: string; schema: Record<string, unknown> }; narration: string }
  | { kind: "error"; message: string };

// ─── The bot ────────────────────────────────────────────────────────────────

export async function runWorkflowAuthorBot(input: AuthorBotInput): Promise<AuthorBotOutcome> {
  // Capture-on-call slots for the three "terminal" tools. The bot calls
  // exactly one of these per turn; we read whichever was set after runBot
  // returns. Explicit types keep narrowing predictable across the closures.
  type EmittedSlot = { spec: unknown };
  type ClarificationSlot = { question: string; suggestions?: string[] };
  type EntitySlot = { name: string; display_name: string; schema: Record<string, unknown> };
  let emitted: EmittedSlot | null = null;
  let clarification: ClarificationSlot | null = null;
  let proposedEntity: EntitySlot | null = null;

  const tools: ToolSet = {
    list_available_triggers: tool({
      description:
        "List all available trigger events. Optionally filter by surface ('tasks', 'chat', 'docs', 'meetings', 'calendar', 'entities', 'system'). Use this to discover what events you can trigger on.",
      inputSchema: z.object({ surface: SURFACE_ENUM.optional() }),
      execute: async ({ surface }) => {
        const list = triggersBySurface(surface);
        return {
          count: list.length,
          triggers: list.map((t) => ({
            id: t.id,
            surface: t.surface,
            label: t.label,
            description: t.description,
            examples: t.examplePrompts,
          })),
        };
      },
    }),

    list_available_actions: tool({
      description:
        "List all available action / AI / control step types. Optionally filter by surface. Use to discover what steps you can compose into the workflow body.",
      inputSchema: z.object({ surface: SURFACE_ENUM.optional() }),
      execute: async ({ surface }) => {
        const list = stepsBySurface(surface);
        return {
          count: list.length,
          steps: list.map((s) => ({
            id: s.id,
            surface: s.surface,
            category: s.category,
            label: s.label,
            description: s.description,
            examples: s.examplePrompts,
          })),
        };
      },
    }),

    describe_action: tool({
      description:
        "Fetch the full schema + examples for one action / AI / control step. Call this before using a step type for the first time so you know its exact config shape.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const entry = getStep(id as never);
        if (!entry) return { error: `unknown step id: ${id}` };
        return {
          id: entry.id,
          surface: entry.surface,
          category: entry.category,
          label: entry.label,
          description: entry.description,
          examples: entry.examplePrompts,
          // We don't serialize the Zod inputSchema here — the AI works better
          // from the human-readable description + examples. The validate pass
          // catches schema mismatches and lets the bot retry.
        };
      },
    }),

    list_entity_types: tool({
      description:
        "List the entity types declared on this property. Use to see whether a 'room', 'guest', etc. type already exists before referencing it in actions.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("entity_types")
          .select("name, display_name, schema")
          .eq("property_id", input.propertyId);
        return {
          count: (data ?? []).length,
          entity_types: (data ?? []).map((t) => ({
            name: t.name,
            display_name: t.display_name,
            schema: t.schema,
          })),
        };
      },
    }),

    propose_entity_type: tool({
      description:
        "When the goal needs an entity type that doesn't exist yet (e.g. 'room', 'guest', 'booking'), propose creating it. The user will be shown your proposal and can accept/reject — STOP after calling this; don't also emit the workflow. We'll re-invoke you once the entity type is created.",
      inputSchema: z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case"),
        display_name: z.string().min(1),
        schema: z.record(z.string(), z.unknown()).describe("A JSON Schema describing the entity's data shape."),
      }),
      execute: async (args) => {
        proposedEntity = args;
        return { ok: true };
      },
    }),

    ask_clarification: tool({
      description:
        "When the goal is ambiguous (missing channel, unclear assignee, undefined wait duration), ask the user a focused question with 2-3 suggested answers. STOP after calling this; don't also emit the workflow.",
      inputSchema: z.object({
        question: z.string().min(1),
        suggestions: z.array(z.string()).max(5).optional(),
      }),
      execute: async (args) => {
        clarification = args;
        return { ok: true };
      },
    }),

    emit_workflow: tool({
      description:
        "Emit the final WorkflowSpec — the workflow you've designed. Call this EXACTLY ONCE per turn, only AFTER you've discovered the right trigger and action types via the list_/describe_ tools. The spec must be a complete, valid WorkflowSpec object. We validate it and feed errors back if invalid.",
      inputSchema: z.object({
        spec: z.unknown().describe("A complete WorkflowSpec JSON object."),
      }),
      execute: async (args) => {
        emitted = args as { spec: unknown };
        // Surface validation errors so the bot can self-correct in another tool turn.
        const validation = validateSpec(args.spec);
        if (!validation.ok) {
          const issues = validation.issues
            .map((i) => `${i.path}: ${i.message}`)
            .join("; ");
          return { error: `spec invalid — ${issues}` };
        }
        return { ok: true };
      },
    }),
  };

  const userTurn: ModelMessage = {
    role: "user",
    content: buildUserMessage(input),
  };

  const messages: ModelMessage[] = [
    ...(input.conversation ?? []),
    userTurn,
  ];

  const result = await runBot({
    persona: PERSONA,
    activationReason: "mention",
    scopedTools: tools,
    messages,
    scope: {
      propertyId: input.propertyId,
      userId: input.userId,
      surface: "workflow",
    },
  });

  // TS can't narrow `let` slots set inside async tool callbacks — it assumes
  // they remain null. Hoist into typed locals at the boundary instead.
  const clarificationSlot = clarification as ClarificationSlot | null;
  const proposedEntitySlot = proposedEntity as EntitySlot | null;
  const emittedSlot = emitted as EmittedSlot | null;

  if (clarificationSlot) {
    return {
      kind: "clarification",
      question: clarificationSlot.question,
      suggestions: clarificationSlot.suggestions ?? [],
      narration: result.text,
    };
  }
  if (proposedEntitySlot) {
    return {
      kind: "propose_entity_type",
      entity: proposedEntitySlot,
      narration: result.text,
    };
  }
  if (!emittedSlot) {
    return {
      kind: "error",
      message: "Bot did not call emit_workflow / ask_clarification / propose_entity_type.",
    };
  }

  // Final hard-validate (we already validated inside the tool, but the tool's
  // error gets fed back to the model — and the model might call emit_workflow
  // again with a fixed spec. By the time runBot returns, `emittedSlot` holds
  // the most recent call. Re-validate to be safe.)
  const parsed = WorkflowSpec.safeParse(emittedSlot.spec);
  if (!parsed.success) {
    return {
      kind: "error",
      message: `Final spec failed validation: ${parsed.error.message}`,
    };
  }

  return { kind: "spec", spec: parsed.data, narration: result.text };
}

// ─── Prompt assembly ─────────────────────────────────────────────────────────

function buildUserMessage(input: AuthorBotInput): string {
  const lines: string[] = [];
  lines.push(`Goal: ${input.goal}`);
  if (input.currentSpec) {
    lines.push("");
    lines.push("You are EDITING an existing workflow. The current spec is:");
    lines.push("```json");
    lines.push(JSON.stringify(input.currentSpec, null, 2));
    lines.push("```");
    lines.push(
      "Emit a complete updated WorkflowSpec via `emit_workflow` (full replacement, not a delta).",
    );
  } else {
    lines.push("");
    lines.push(
      "Design a NEW workflow that achieves this goal. Discover the right trigger and action types via the catalog tools, then emit the spec via `emit_workflow`.",
    );
  }

  // Inline a one-line catalog summary so the bot has an at-a-glance view
  // without paying for a tool call when the goal is obvious.
  lines.push("");
  lines.push("Quick catalog summary (call list_/describe_ for details):");
  lines.push(`- Triggers: ${TRIGGERS.map((t) => t.id).join(", ")}`);
  lines.push(`- Steps: ${STEPS.map((s) => s.id).join(", ")}`);

  return lines.join("\n");
}

// Surface enum convenience for downstream UIs.
export const AUTHOR_SURFACES: Surface[] = [
  "tasks",
  "chat",
  "docs",
  "meetings",
  "calendar",
  "entities",
  "system",
  "ai",
  "control",
  "external",
];
