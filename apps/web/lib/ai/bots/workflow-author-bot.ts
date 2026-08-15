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
import { getPropertyChannels } from "@/lib/chat/channels";
import {
  STEPS,
  TRIGGERS,
  getStep,
  getTrigger,
  triggersBySurface,
  stepsBySurface,
} from "@/lib/workflows/catalog";
import { WorkflowSpec } from "@/lib/workflows/spec";
import { validateSpec } from "@/lib/workflows/validate";
import type { Surface } from "@/lib/workflows/catalog/types";
import {
  authorConfigFields,
  authorExampleConfig,
  authorTriggerFilterHint,
} from "@/lib/workflows/author-config-hints";
import type { StepType, TriggerEventType } from "@/lib/workflows/spec";

const PERSONA = [
  "You are the Workflow Author for Hotelclaw — an expert at turning hotel-ops goals into reliable automations on this property's surfaces (tasks, chat, docs, meetings, calendar, and workflow-defined entities like rooms or guests).",
  "Your output is a single call to `emit_workflow` with a complete WorkflowSpec JSON. Never invent action types — call `list_available_actions` / `describe_action` first and only use ids that appear there.",
  "Every step MUST include a fully populated `config` object. Empty configs or missing required keys fail validation. Call `describe_action` for each step type you use and copy the example_config shape.",
  "Template refs: `{{trigger.new.description}}`, `{{trigger.new.id}}`, `{{steps.<step_id>.output.summary}}`, `{{vars.name}}`. Never leave required string fields undefined — use a template ref or call `ask_clarification` / `list_property_members` for assignees.",
  "NEVER put a raw id in text a person reads. `assignee_id` is a uuid — a chat message saying '*Assignee:* 33831554-d1a7-…' is a real bug we shipped once. In any human-facing string (chat text, notification body, doc content) use the `_name` companion: `{{trigger.new.assignee_name}}`. Reserve the `_id` form for fields that address a record — assignee_id on an assign step, task_id, channel_id.",
  "For task.label_added workflows, prefer putting label filters on `trigger.filter.expr` (not a separate control.filter step) unless you need mid-flow filtering.",
  "Prefer the fewest steps that achieve the goal. Don't add ceremony.",
  "For schedule.cron workflows: set trigger.schedule.cron and timezone; never emit empty trigger.filter. Step output refs must use real step ids from the spec (e.g. {{steps.fetch_tasks.output.text}}), never invented names.",
  "Hotel-domain reflex: housekeeping, F&B, front desk, escalations to GM are real categories — map vague language to them. If the workflow would benefit from a new entity type (rooms, guests, bookings), call `propose_entity_type` and explain the value.",
  "When the goal is ambiguous (which channel? which assignee? how long to wait?), RESOLVE IT YOURSELF FIRST: `list_channels` for a named channel, `list_property_members` for a named person. Both return the real ids. A channel id and a user id are opaque values the user cannot type from memory — asking for one is always the wrong move when a lookup would answer it. Fall back to `ask_clarification` (2-3 suggested answers) only when the lookup comes back empty or genuinely ambiguous.",
].join("\n\n");

const AUTHOR_GUIDELINES = [
  "You are building JSON, not narrating. Call describe_action for every step type before emit_workflow.",
  "If emit_workflow returns validation errors, read them, fix the spec, and call emit_workflow again with the corrected full spec.",
  "Do not emit placeholder step nodes with empty config objects.",
  "Your final reply to the user (the narration shown in the UI) must be one or two plain-English sentences a non-technical hotel manager understands. Describe what the workflow does in their words. NEVER expose template syntax ({{...}}), field paths (trigger.new.x, steps.x.output), JSON, step type ids, or tool names in that reply.",
].join(" ");

// MUST stay in sync with `Surface` in lib/workflows/catalog/types.ts — this is
// the enum the bot filters `list_available_actions` / `describe_action` by, so
// a missing member means the bot can't narrow to that surface at all (it
// omitted "bookings" until 2026-08-14, which made every bookings-scoped
// authoring turn fail tool-input validation and fall back to the full catalog).
const SURFACE_ENUM = z.enum([
  "tasks",
  "chat",
  "docs",
  "forms",
  "bookings",
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
        const stepType = entry.id as StepType;
        return {
          id: entry.id,
          surface: entry.surface,
          category: entry.category,
          label: entry.label,
          description: entry.description,
          examples: entry.examplePrompts,
          config_fields: authorConfigFields(stepType),
          example_config: authorExampleConfig(stepType),
          branches:
            stepType === "control.branch_if" || stepType === "ai.branch_decision"
              ? { true: "<step_id>", false: "<step_id>" }
              : undefined,
        };
      },
    }),

    describe_trigger: tool({
      description:
        "Fetch trigger details including filter guidance and available trigger payload paths.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const entry = getTrigger(id as TriggerEventType);
        if (!entry) return { error: `unknown trigger id: ${id}` };
        return {
          id: entry.id,
          surface: entry.surface,
          label: entry.label,
          description: entry.description,
          examples: entry.examplePrompts,
          filter_hint: authorTriggerFilterHint(entry.id),
        };
      },
    }),

    list_property_members: tool({
      description:
        "List members of this property (id, name, role). Use when a step needs assignee_id or you need to pick a specific person.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = createServiceClient();
        const { data: members, error: membersErr } = await supabase
          .from("memberships")
          .select("user_id, role")
          .eq("property_id", input.propertyId);
        if (membersErr) return { error: membersErr.message };
        if (!members?.length) return { count: 0, members: [] };

        const userIds = members.map((m) => m.user_id);
        const { data: profiles, error: profilesErr } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profilesErr) return { error: profilesErr.message };

        const byId = new Map((profiles ?? []).map((p) => [p.id, p.full_name] as const));
        return {
          count: members.length,
          members: members.map((row) => ({
            user_id: row.user_id,
            role: row.role,
            name: byId.get(row.user_id) ?? row.user_id,
          })),
        };
      },
    }),

    list_channels: tool({
      description:
        "List this property's chat channels (name + the channel_id every chat step needs). Call this WHENEVER the goal names a channel — 'post to #ops', 'tell the F&B team' — and match the name yourself. Never ask the user for a channel id: it is an opaque Stream id they cannot know. Only ask if NO channel plausibly matches the name they used.",
      inputSchema: z.object({}),
      execute: async () => {
        const supabase = createServiceClient();
        try {
          const channels = await getPropertyChannels(supabase, input.propertyId);
          return {
            count: channels.length,
            channels: channels.map((c) => ({
              name: c.name,
              channel_id: c.streamChannelId,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "lookup failed" };
        }
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
        const validation = validateSpec(args.spec);
        if (!validation.ok) {
          const issues = validation.issues
            .map((i) => `${i.path}: ${i.message}`)
            .join("; ");
          return {
            error: `spec invalid — fix these and call emit_workflow again: ${issues}`,
          };
        }
        emitted = args as { spec: unknown };
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
    responseGuidelines: AUTHOR_GUIDELINES,
    maxToolSteps: 12,
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
      message:
        result.text.trim() ||
        "Bot did not produce a valid workflow. It may have run out of tool steps while fixing validation errors — try a simpler goal or refine in a follow-up message.",
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

  lines.push("");
  lines.push(
    "Reference spec (guest complaint — note trigger.filter + populated configs):",
  );
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        workflow_spec_version: 1,
        name: "Guest complaint escalation",
        trigger: {
          event_type: "task.label_added",
          filter: {
            expr: { in: ["guest-complaint", { var: "trigger.added_labels" }] },
          },
        },
        entry_step_id: "summarize",
        steps: {
          summarize: {
            id: "summarize",
            type: "ai.summarize_text",
            config: {
              input: "{{trigger.new.description}}",
              length: "short",
            },
            next: "notify",
          },
          notify: {
            id: "notify",
            type: "action.notify.role",
            config: {
              role: "manager",
              title: "Guest complaint",
              body: "{{steps.summarize.output.summary}}",
              notification_type: "workflow",
            },
          },
        },
      },
      null,
      2,
    ),
  );
  lines.push("```");

  return lines.join("\n");
}

// Surface enum convenience for downstream UIs.
export const AUTHOR_SURFACES: Surface[] = [
  "tasks",
  "chat",
  "docs",
  "forms",
  "bookings",
  "meetings",
  "calendar",
  "entities",
  "system",
  "ai",
  "control",
  "external",
];
