import { z } from "zod";
import type { WorkflowSpec } from "./spec";
import { getStep, getTrigger } from "./catalog";
import { buildUpstreamMap } from "./validate";
import { humanizeRef } from "./explain-expr";

// What data a step can reference — used by the config data-picker and the
// condition field-picker so users never have to type a dotted `{{...}}` path
// by hand. We surface three groups:
//
//   • From trigger   — fields on the event payload ({{trigger.*}})
//   • From step N     — the typed output of any UPSTREAM step (catalog
//                       outputSchema), e.g. {{steps.classify.output.label}}
//   • Variables       — workflow-level vars ({{vars.*}})
//
// Trigger payloads are intentionally loose at the schema layer (z.record), so
// the inner fields can't be enumerated from the schema. We instead surface a
// curated set of the well-documented fields per trigger family (the same ones
// the catalog descriptions + field-defs placeholders reference) and always
// let the user free-type a leaf in the picker.

export type RefType = "string" | "number" | "boolean" | "string[]" | "json";

export interface RefCandidate {
  /** Human label, e.g. "Priority" or "Chosen label". */
  label: string;
  /** Dotted path stored inside the {{...}} template, e.g. "trigger.new.priority". */
  path: string;
  /** Group heading for the picker. */
  group: string;
  type: RefType;
  /** Optional example value to show beside the label. */
  sample?: string;
  /**
   * Known set of values this field can take (enum-like). When present, the
   * condition builder offers these as a dropdown / chips instead of a free-text
   * box, so users never have to type a magic string. Kept as raw tokens —
   * humanised for display at the edge.
   */
  options?: string[];
}

// Canonical enum value lists, mirrored from lib/db/types.ts (TaskStatus /
// TaskPriority). Those are type-only, so we keep runtime arrays here for the
// field catalog. Update both together if the domain enums change.
const TASK_STATUS_OPTIONS = ["todo", "in_progress", "blocked", "done"];
const TASK_PRIORITY_OPTIONS = ["none", "low", "medium", "high", "urgent"];

/** Curated, well-documented trigger fields by event-type prefix. */
const TRIGGER_FIELDS: Record<
  string,
  Array<{ path: string; type: RefType; sample?: string; options?: string[] }>
> = {
  task: [
    { path: "trigger.new.title", type: "string", sample: "Fix A/C in 203" },
    {
      path: "trigger.new.description",
      type: "string",
      sample: "Guest reports room is too cold",
    },
    {
      path: "trigger.new.priority",
      type: "string",
      sample: "urgent",
      options: TASK_PRIORITY_OPTIONS,
    },
    { path: "trigger.new.status", type: "string", sample: "todo", options: TASK_STATUS_OPTIONS },
    { path: "trigger.new.assignee_id", type: "string" },
    { path: "trigger.new.due_at", type: "string" },
    { path: "trigger.new.id", type: "string" },
    { path: "trigger.new.labels", type: "string[]", sample: "guest-complaint" },
  ],
  chat: [
    { path: "trigger.message.text", type: "string", sample: "The room is freezing" },
    { path: "trigger.channel.id", type: "string", sample: "front-desk" },
    { path: "trigger.user.id", type: "string" },
  ],
  doc: [
    { path: "trigger.new.title", type: "string" },
    { path: "trigger.new.id", type: "string" },
  ],
  meeting: [{ path: "trigger.meeting.id", type: "string" }],
  calendar: [{ path: "trigger.event.id", type: "string" }],
  entity: [{ path: "trigger.entity_type", type: "string" }],
  schedule: [
    {
      path: "trigger.fired_at",
      type: "string",
      sample: "2026-06-01T09:00:00Z",
    },
  ],
  manual: [
    { path: "trigger.run_by_user_id", type: "string" },
  ],
};

/** Extra fields specific to particular trigger event types. */
const TRIGGER_EXTRAS: Record<
  string,
  Array<{ path: string; type: RefType; options?: string[] }>
> = {
  "task.status_changed": [
    { path: "trigger.from", type: "string", options: TASK_STATUS_OPTIONS },
    { path: "trigger.to", type: "string", options: TASK_STATUS_OPTIONS },
  ],
  "task.assigned": [
    { path: "trigger.from", type: "string" },
    { path: "trigger.to", type: "string" },
  ],
  "task.label_added": [{ path: "trigger.added_labels", type: "string[]" }],
};

/** Map a Zod field type to our coarse RefType (best effort, never throws). */
function zodType(schema: z.ZodTypeAny | undefined): RefType {
  try {
    if (schema instanceof z.ZodString) return "string";
    if (schema instanceof z.ZodNumber) return "number";
    if (schema instanceof z.ZodBoolean) return "boolean";
    if (schema instanceof z.ZodArray) return "string[]";
    if (schema instanceof z.ZodEnum) return "string";
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return zodType((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
    }
  } catch {
    /* fall through */
  }
  return "json";
}

/** Enum option tokens for a Zod schema (unwrapping optional/nullable), or undefined. */
function enumOptions(schema: z.ZodTypeAny | undefined): string[] | undefined {
  try {
    if (schema instanceof z.ZodEnum) {
      return (schema.options as readonly unknown[]).map(String);
    }
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return enumOptions((schema as z.ZodOptional<z.ZodTypeAny>).unwrap());
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

/** Top-level keys of a ZodObject, or [] for anything else. */
function objectFields(
  schema: z.ZodTypeAny | undefined,
): Array<{ key: string; type: RefType; options?: string[] }> {
  try {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      return Object.entries(shape).map(([key, v]) => ({
        key,
        type: zodType(v),
        options: enumOptions(v),
      }));
    }
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Every value a given step can reference, ordered trigger → upstream steps →
 * variables. `stepId` may be the trigger sentinel or undefined (offers
 * trigger + vars only).
 */
export function availableRefs(spec: WorkflowSpec, stepId?: string): RefCandidate[] {
  const out: RefCandidate[] = [];

  // ── From trigger ──────────────────────────────────────────────────────────
  const eventType = spec.trigger.event_type;
  const family = eventType.split(".")[0] ?? "";
  const triggerLabel = getTrigger(eventType)?.label ?? "trigger";
  const triggerGroup = `From the trigger · ${triggerLabel}`;
  const seen = new Set<string>();
  const pushTrigger = (path: string, type: RefType, sample?: string, options?: string[]) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ label: humanizeRef(path), path, group: triggerGroup, type, sample, options });
  };
  for (const f of TRIGGER_FIELDS[family] ?? []) pushTrigger(f.path, f.type, f.sample, f.options);
  for (const f of TRIGGER_EXTRAS[eventType] ?? [])
    pushTrigger(f.path, f.type, undefined, f.options);

  // ── From upstream steps ─────────────────────────────────────────────────────
  if (stepId) {
    const upstream = buildUpstreamMap(spec).get(stepId) ?? new Set<string>();
    for (const [id, step] of Object.entries(spec.steps)) {
      if (!upstream.has(id)) continue;
      const meta = getStep(step.type);
      const fields = objectFields(meta?.outputSchema);
      if (fields.length === 0) continue;
      const stepName = step.label || meta?.label || id;
      const group = `From “${stepName}”`;
      for (const { key, type, options } of fields) {
        out.push({
          label: humanizeRef(`${id}.${key}`),
          path: `steps.${id}.output.${key}`,
          group,
          type,
          options,
        });
      }
    }
  }

  // ── Variables ───────────────────────────────────────────────────────────────
  for (const [name, decl] of Object.entries(spec.variables ?? {})) {
    out.push({
      label: name,
      path: `vars.${name}`,
      group: "Variables",
      type: (decl.type as RefType) ?? "string",
      sample: decl.default != null ? String(decl.default) : undefined,
    });
  }

  return out;
}

/** Group RefCandidates by their `group` heading, preserving first-seen order. */
export function groupRefs(refs: RefCandidate[]): Array<{ group: string; items: RefCandidate[] }> {
  const map = new Map<string, RefCandidate[]>();
  for (const r of refs) {
    const list = map.get(r.group);
    if (list) list.push(r);
    else map.set(r.group, [r]);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}
