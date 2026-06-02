import type { z } from "zod";
import type { StepType, TriggerEventType } from "@/lib/workflows/spec";

// Catalog entries are pure METADATA — they describe each trigger / action /
// AI / control step well enough for the canvas, the AI authoring bot, and
// the run inspector to render and reason about them. They MUST be client-
// safe: no runners, no server-only imports.
//
// Runners (the actual side-effecting code) live in lib/workflows/runners/
// behind a server-only RUNNERS map. The runtime imports the map; the
// catalog never does. This split is what keeps the catalog importable from
// the tree-list / canvas builders and other client components without
// dragging Supabase + Stream + the AI SDK into the browser bundle.
//
// `description` + `examplePrompts` are the AI's vocabulary — write them like
// tool descriptions (see lib/ai/bots/task-bot.ts for tone).

export type Surface =
  | "tasks"
  | "chat"
  | "docs"
  | "meetings"
  | "calendar"
  | "entities"
  | "system"
  | "ai"
  | "control"
  | "external";

export type Category = "trigger" | "action" | "ai" | "control";

export interface RunnerContext {
  propertyId: string;
  /** The user who owns the workflow (NOT the user who triggered the event). */
  workflowOwnerId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  /** Resolved upstream values: { trigger, steps, vars, context }. */
  scope: Record<string, unknown>;
  dryRun: boolean;
  /** AI runners call this with a compact model trace; the runtime persists it
   *  to workflow_step_runs.ai_trace for the run inspector. */
  recordTrace?: (trace: Record<string, unknown>) => void;
}

export type Runner = (args: {
  config: unknown;
  ctx: RunnerContext;
}) => Promise<unknown>;

export interface TriggerCatalogEntry {
  id: TriggerEventType;
  surface: Surface;
  category: "trigger";
  label: string;
  description: string;
  examplePrompts: string[];
  outputSchema?: z.ZodTypeAny;
  explain: (filter?: unknown) => string;
}

export interface StepCatalogEntry {
  id: StepType;
  surface: Surface;
  category: Exclude<Category, "trigger">;
  label: string;
  description: string;
  examplePrompts: string[];
  outputSchema?: z.ZodTypeAny;
  explain: (config: unknown) => string;
}

export type CatalogEntry = TriggerCatalogEntry | StepCatalogEntry;
