import type { StepType, TriggerEventType } from "@/lib/workflows/spec";
import { STEPS, TRIGGERS, getStep, getTrigger } from "@/lib/workflows/catalog";
import type { Surface } from "@/lib/workflows/catalog/types";

/**
 * The **feature lens** over the workflow catalog — "which automations touch
 * Docs?" answered from a workflow's trigger + step ids alone.
 *
 * A feature is NOT the same thing as a catalog `Surface`. Surfaces are the
 * catalog's own taxonomy (they include plumbing buckets like `ai`, `control`,
 * `system`, `external`), while a feature is a place in the app a person
 * navigates to and expects a lightning button on. The two mostly line up, but
 * two cases force the indirection:
 *
 *   • **Chatbots** have no surface of their own — `chatbot.*` triggers are
 *     filed under `external` next to webhooks and HTTP calls. Matching on the
 *     surface alone would show "when a webhook fires" automations on the
 *     Chatbots page.
 *   • **Calendar** and **Meetings** are separate app sections but share
 *     scheduling vocabulary, so each names the surfaces it owns explicitly.
 *
 * So each feature declares the surfaces it claims AND an optional list of id
 * prefixes. A workflow belongs to a feature when ANY of its catalog ids (the
 * trigger plus every step) matches either rule. Deliberately generous: showing
 * one extra automation in the modal is a much cheaper failure than hiding the
 * one the user came to find.
 *
 * Client-safe — this only reads catalog metadata, never a runner.
 */

export type AutomationFeature =
  | "tasks"
  | "chat"
  | "docs"
  | "meetings"
  | "calendar"
  | "forms"
  | "bookings"
  | "chatbots"
  | "entities";

export const AUTOMATION_FEATURES: AutomationFeature[] = [
  "tasks",
  "chat",
  "docs",
  "meetings",
  "calendar",
  "forms",
  "bookings",
  "chatbots",
  "entities",
];

type FeatureDef = {
  /** How the feature names itself in the modal title and copy. */
  label: string;
  /** One line under the title — what automating this feature buys you. */
  blurb: string;
  /** Catalog surfaces this feature claims outright. */
  surfaces: Surface[];
  /**
   * Extra trigger/step id prefixes that belong to this feature regardless of
   * their catalog surface (chatbots live under `external`).
   */
  idPrefixes?: string[];
};

const FEATURES: Record<AutomationFeature, FeatureDef> = {
  tasks: {
    label: "Tasks",
    blurb:
      "Route, escalate, and follow up on work without anyone remembering to.",
    surfaces: ["tasks"],
  },
  chat: {
    label: "Chat",
    blurb: "Turn what gets said in a channel into work that actually happens.",
    surfaces: ["chat"],
  },
  docs: {
    label: "Documents",
    blurb: "Keep SOPs, notes, and handovers moving after they're written.",
    surfaces: ["docs"],
  },
  meetings: {
    label: "Meetings",
    blurb: "Make summaries and action items land somewhere the next shift sees.",
    surfaces: ["meetings"],
  },
  calendar: {
    label: "Calendar",
    blurb: "React to what's coming up before it arrives.",
    surfaces: ["calendar"],
  },
  forms: {
    label: "Forms",
    blurb: "Send every submission somewhere it gets acted on.",
    surfaces: ["forms"],
  },
  bookings: {
    label: "Bookings",
    blurb: "Confirm, chase, and flag reservations on their own.",
    surfaces: ["bookings"],
  },
  chatbots: {
    label: "Chatbots",
    blurb: "Catch guest escalations and orders the moment the bot hands off.",
    // `chatbot.*` triggers are filed under `external`; claiming that whole
    // surface would drag webhooks in, so this feature matches by id only.
    surfaces: [],
    idPrefixes: ["chatbot."],
  },
  entities: {
    label: "Records",
    blurb: "Keep custom records (rooms, assets, guests) in step with the work.",
    surfaces: ["entities"],
  },
};

export function featureMeta(feature: AutomationFeature): FeatureDef {
  return FEATURES[feature];
}

/**
 * The catalog ids a workflow is built from. The list API returns exactly this
 * shape per workflow so the client can run the lens without loading specs.
 */
export type WorkflowCatalogIds = {
  trigger_event_type: string | null;
  step_types: string[];
};

function idMatchesFeature(id: string, def: FeatureDef, isTrigger: boolean): boolean {
  if (def.idPrefixes?.some((p) => id.startsWith(p))) return true;
  if (def.surfaces.length === 0) return false;
  const entry = isTrigger
    ? getTrigger(id as TriggerEventType)
    : getStep(id as StepType);
  return entry ? def.surfaces.includes(entry.surface) : false;
}

/** Does this workflow read from, or act on, the given feature? */
export function workflowTouchesFeature(
  ids: WorkflowCatalogIds,
  feature: AutomationFeature,
): boolean {
  const def = FEATURES[feature];
  if (ids.trigger_event_type && idMatchesFeature(ids.trigger_event_type, def, true)) {
    return true;
  }
  return ids.step_types.some((t) => idMatchesFeature(t, def, false));
}

/**
 * Whether the feature is the workflow's TRIGGER (it starts here) or only one
 * of its steps (it ends up here). The modal labels the difference so a long
 * list stays scannable.
 */
export function featureRole(
  ids: WorkflowCatalogIds,
  feature: AutomationFeature,
): "trigger" | "action" | null {
  const def = FEATURES[feature];
  if (ids.trigger_event_type && idMatchesFeature(ids.trigger_event_type, def, true)) {
    return "trigger";
  }
  if (ids.step_types.some((t) => idMatchesFeature(t, def, false))) return "action";
  return null;
}

/** Every catalog trigger id this feature owns — context for the AI suggester. */
export function featureTriggerIds(feature: AutomationFeature): TriggerEventType[] {
  const def = FEATURES[feature];
  return TRIGGER_IDS.filter((id) => idMatchesFeature(id, def, true));
}

/** Every catalog step id this feature owns — context for the AI suggester. */
export function featureStepIds(feature: AutomationFeature): StepType[] {
  const def = FEATURES[feature];
  return STEP_IDS.filter((id) => idMatchesFeature(id, def, false));
}

const TRIGGER_IDS: TriggerEventType[] = TRIGGERS.map((t) => t.id);
const STEP_IDS: StepType[] = STEPS.map((s) => s.id);

/**
 * Base64 `?prefill=` payload the workflow builder decodes into its first
 * copilot turn (see `new-workflow-client.tsx:decodePrefillGoal`).
 *
 * `btoa` only accepts Latin-1, so a goal carrying a suggestion title with an
 * en dash or an accented property name would throw on the way into the URL.
 * We encode the UTF-8 bytes first; the decoder reverses it. Pure-ASCII
 * payloads round-trip identically to the old `btoa(JSON.stringify(x))` form,
 * so links already in the wild keep working.
 */
export function builderPrefillHref(
  propertyId: string,
  goal: string,
  extra?: Record<string, unknown>,
): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ goal, ...extra }));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return `/p/${propertyId}/workflows/new?prefill=${encodeURIComponent(b64)}`;
}
