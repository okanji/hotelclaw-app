import { z } from "zod";

/**
 * The form definition JSON stored in `forms.schema` — one versioned shape
 * shared by the builder, the renderer, AI generation (`generateObject`
 * against `FormSchemaZod`), workflow payloads, and onboarding. Owning this
 * schema (rather than a third-party spec format) keeps persisted forms
 * stable across dependency upgrades; bump `version` and migrate forward if
 * the shape ever has to change.
 */

export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "select",
  "multi_select",
  "yes_no",
  "rating",
  "date",
  "file",
  "section",
  // ClickUp-parity additions (2026-08-12). Every new key on FormFieldZod is
  // optional and every new type gets a validateFieldAnswer / formatAnswer /
  // FIELD_TYPE_META / FormFieldInput case — parseFormSchema falls back to an
  // EMPTY schema on any parse failure, so a miss here wipes forms in the UI.
  "people",
  "signature",
  "info",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Layout-only blocks that collect no input. */
export const LAYOUT_FIELD_TYPES: readonly FormFieldType[] = ["section", "info"];

export const FormFieldOptionZod = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

/**
 * Data-connected option sources for choice fields. When a select /
 * multi_select carries a `source`, its options are resolved live from app
 * data (see `lib/forms/resolve-options.ts`) instead of the hand-typed
 * `options` array. Stored answers keep the raw ids (or, for sheet columns,
 * the cell value itself).
 */
export const FORM_SOURCE_KINDS = [
  "members",
  "projects",
  "tasks",
  "spaces",
  "labels",
  "sheet_column",
] as const;
export type FormSourceKind = (typeof FORM_SOURCE_KINDS)[number];

export const FormFieldSourceZod = z.object({
  kind: z.enum(FORM_SOURCE_KINDS),
  /** sheet_column: the sheet document id. */
  documentId: z.string().optional(),
  /** sheet_column: the column id within the first sheet. */
  column: z.string().optional(),
});
export type FormFieldSource = z.infer<typeof FormFieldSourceZod>;

/**
 * Task-property mapping (ClickUp's "Task property" questions): a field whose
 * answer writes a STRUCTURED task field on the auto-created task, instead of
 * only landing in the description. `submitFormResponse` folds mapped answers
 * into the `task_properties` block of the form.submitted payload, and the
 * task automation references them as `{{trigger.task_properties.*}}`.
 */
export const TASK_PROPERTY_KINDS = [
  "assignee",
  "priority",
  "due_date",
  "labels",
] as const;
export type TaskPropertyKind = (typeof TASK_PROPERTY_KINDS)[number];

export const TASK_PROPERTY_META: Record<
  TaskPropertyKind,
  { label: string; description: string; fieldType: FormFieldType }
> = {
  assignee: {
    label: "Assignee",
    description: "Who the created task is assigned to",
    fieldType: "people",
  },
  priority: {
    label: "Priority",
    description: "The created task's priority",
    fieldType: "select",
  },
  due_date: {
    label: "Due date",
    description: "The created task's due date",
    fieldType: "date",
  },
  labels: {
    label: "Tags",
    description: "Labels applied to the created task",
    fieldType: "multi_select",
  },
};

/** Fixed options for a priority-mapped select — ids ARE task priorities. */
export const PRIORITY_FIELD_OPTIONS = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
] as const;

/**
 * Conditional visibility ("show this question only when…"). Conditions may
 * only reference EARLIER fields (the builder enforces it); visibility
 * cascades — a field whose controller is hidden is hidden too. A condition
 * whose controller was deleted fails OPEN (the field shows) so a stale ref
 * never silently hides a required question.
 */
export const CONDITION_OPS = [
  "answered",
  "not_answered",
  "equals",
  "not_equals",
  "contains",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const FormFieldConditionZod = z.object({
  fieldId: z.string().min(1),
  op: z.enum(CONDITION_OPS),
  /** Comparison value for equals / not_equals / contains — an option id for
   *  choice fields, "yes"/"no" for yes_no, plain text otherwise. */
  value: z.string().optional(),
});
export type FormFieldCondition = z.infer<typeof FormFieldConditionZod>;

export const FormFieldZod = z.object({
  id: z.string().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().min(1),
  /** Helper text under the label (for `info`, the block's body text). */
  description: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  /** For select / multi_select. */
  options: z.array(FormFieldOptionZod).optional(),
  /** For select / multi_select / people: populate options live from app data. */
  source: FormFieldSourceZod.optional(),
  /** For number: bounds. */
  min: z.number().optional(),
  max: z.number().optional(),
  /** For rating: scale size, 3–10 (default 5). */
  maxRating: z.number().int().min(3).max(10).optional(),
  /** Map this answer onto a structured field of the auto-created task. */
  taskProperty: z.enum(TASK_PROPERTY_KINDS).optional(),
  /** Show this field only when an earlier answer matches. */
  condition: FormFieldConditionZod.optional(),
});

/**
 * Form-level presentation settings (ClickUp's Settings rail), stored INSIDE
 * the schema JSON so no migration is needed and the builder's working copy
 * carries them. `redirectUrl` is deliberately a loose string — a malformed
 * value must never make parseFormSchema wipe the form; the fill surface only
 * follows http(s) URLs.
 */
export const FORM_BACKGROUNDS = [
  "default",
  "lavender",
  "blue",
  "sage",
  "coral",
  "honey",
] as const;
export type FormBackground = (typeof FORM_BACKGROUNDS)[number];

export const FormSettingsZod = z.object({
  /** Submit button label (default "Submit"). */
  submitLabel: z.string().max(40).optional(),
  /** After submitting, send the respondent here (http/https only). */
  redirectUrl: z.string().max(500).optional(),
  /** Replaces the default "Response recorded" thank-you copy. */
  confirmationMessage: z.string().max(500).optional(),
  /** Page-mode field layout. */
  layout: z.enum(["one", "two"]).optional(),
  /** Fill-page background tint (design-system tint tokens). */
  background: z.enum(FORM_BACKGROUNDS).optional(),
});
export type FormSettings = z.infer<typeof FormSettingsZod>;

export const FormSchemaZod = z.object({
  version: z.literal(1),
  fields: z.array(FormFieldZod),
  settings: FormSettingsZod.optional(),
});

export type FormFieldOption = z.infer<typeof FormFieldOptionZod>;
export type FormField = z.infer<typeof FormFieldZod>;
export type FormSchema = z.infer<typeof FormSchemaZod>;

/** One uploaded attachment in a "file" field's answer (see /forms/.../upload). */
export const FormFileValueZod = z.object({
  url: z.string().min(1),
  path: z.string().optional(),
  name: z.string().min(1),
  size: z.number().optional(),
  type: z.string().optional(),
});
export type FormFileValue = z.infer<typeof FormFileValueZod>;

export const MAX_FILES_PER_FIELD = 10;

/** Answers keyed by field id. Value shape depends on the field type. */
export type FormAnswerValue =
  | string
  | number
  | boolean
  | string[]
  | FormFileValue[]
  | null;
export type FormAnswers = Record<string, FormAnswerValue>;

export const EMPTY_FORM_SCHEMA: FormSchema = { version: 1, fields: [] };

/** Fields that collect input (everything except layout-only blocks). */
export function inputFields(schema: FormSchema): FormField[] {
  return schema.fields.filter((f) => !LAYOUT_FIELD_TYPES.includes(f.type));
}

/* ------------------------- Conditional visibility ------------------------- */

/** Is `value` an answered (non-empty) answer? */
function isAnswered(value: FormAnswerValue | undefined): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** String forms of an answer for equals/contains comparison. */
function comparableValues(value: FormAnswerValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "string") return [value];
  return value
    .map((v) => (typeof v === "string" ? v : null))
    .filter((v): v is string => v !== null);
}

function conditionMet(
  condition: FormFieldCondition,
  value: FormAnswerValue | undefined,
): boolean {
  switch (condition.op) {
    case "answered":
      return isAnswered(value);
    case "not_answered":
      return !isAnswered(value);
    case "equals": {
      const target = (condition.value ?? "").trim().toLowerCase();
      const values = comparableValues(value).map((v) => v.trim().toLowerCase());
      return values.length === 1 && values[0] === target;
    }
    case "not_equals": {
      const target = (condition.value ?? "").trim().toLowerCase();
      const values = comparableValues(value).map((v) => v.trim().toLowerCase());
      return !(values.length === 1 && values[0] === target);
    }
    case "contains": {
      const target = (condition.value ?? "").trim().toLowerCase();
      if (!target) return false;
      return comparableValues(value).some((v) => {
        const lower = v.trim().toLowerCase();
        return lower === target || lower.includes(target);
      });
    }
  }
}

/**
 * Which fields are visible given the current answers. Single ordered pass:
 * a condition on a hidden or later field cascades to hidden EXCEPT when the
 * controller no longer exists at all — that fails open (see
 * FormFieldConditionZod). Layout blocks can carry conditions too.
 */
export function computeVisibleFieldIds(
  schema: FormSchema,
  answers: FormAnswers,
): Set<string> {
  const visible = new Set<string>();
  const byId = new Map(schema.fields.map((f) => [f.id, f]));
  for (const field of schema.fields) {
    const condition = field.condition;
    if (!condition || condition.fieldId === field.id) {
      visible.add(field.id);
      continue;
    }
    const controller = byId.get(condition.fieldId);
    if (!controller) {
      visible.add(field.id); // deleted controller — fail open
      continue;
    }
    if (!visible.has(controller.id)) continue; // cascade: hidden controller
    if (conditionMet(condition, answers[controller.id])) visible.add(field.id);
  }
  return visible;
}

/** Visible input fields for the given answers — the set a submission is
 *  validated against. */
export function visibleInputFields(
  schema: FormSchema,
  answers: FormAnswers,
): FormField[] {
  const visible = computeVisibleFieldIds(schema, answers);
  return inputFields(schema).filter((f) => visible.has(f.id));
}

export function parseFormSchema(raw: unknown): FormSchema {
  const parsed = FormSchemaZod.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_FORM_SCHEMA;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate one answer against its field. Returns an error message or null.
 * Used client-side per field and server-side over the whole submission, so
 * the two can't drift.
 */
export function validateFieldAnswer(
  field: FormField,
  value: FormAnswerValue | undefined,
): string | null {
  const empty =
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (empty) {
    return field.required ? "This field is required" : null;
  }

  switch (field.type) {
    case "short_text":
    case "long_text":
      if (typeof value !== "string") return "Expected text";
      if (value.length > 5000) return "Too long";
      return null;
    case "email":
      if (typeof value !== "string" || !EMAIL_RE.test(value)) {
        return "Enter a valid email address";
      }
      return null;
    case "phone":
      if (typeof value !== "string" || value.replace(/[^0-9+]/g, "").length < 5) {
        return "Enter a valid phone number";
      }
      return null;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return "Enter a number";
      if (field.min !== undefined && n < field.min) return `Must be at least ${field.min}`;
      if (field.max !== undefined && n > field.max) return `Must be at most ${field.max}`;
      return null;
    }
    case "select": {
      if (typeof value !== "string") return "Pick an option";
      // Sourced options are resolved live, so membership can't be checked
      // against the stored schema — just require the string shape.
      if (field.source) return null;
      const ids = (field.options ?? []).map((o) => o.id);
      return ids.includes(value) ? null : "Pick an option";
    }
    case "multi_select": {
      if (!Array.isArray(value)) return "Pick at least one option";
      if (field.source) {
        return value.every((v) => typeof v === "string")
          ? null
          : "Pick from the listed options";
      }
      const ids = new Set((field.options ?? []).map((o) => o.id));
      return value.every((v) => typeof v === "string" && ids.has(v))
        ? null
        : "Pick from the listed options";
    }
    case "yes_no":
      return typeof value === "boolean" ? null : "Answer yes or no";
    case "rating": {
      const max = field.maxRating ?? 5;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n) || n < 1 || n > max) return `Rate between 1 and ${max}`;
      return null;
    }
    case "date":
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return "Enter a valid date";
      }
      return null;
    case "file": {
      if (!Array.isArray(value)) return "Attach a file";
      if (value.length > MAX_FILES_PER_FIELD) {
        return `At most ${MAX_FILES_PER_FIELD} files`;
      }
      const ok = value.every(
        (v) => FormFileValueZod.safeParse(v).success,
      );
      return ok ? null : "Attach a file";
    }
    case "people":
      // A member's user id — sourced options resolve live, so membership
      // can't be checked against the stored schema (same as sourced selects).
      return typeof value === "string" && value.length > 0
        ? null
        : "Pick a person";
    case "signature": {
      // A drawn signature as a PNG data URL (or a typed name as fallback).
      // Size-capped so a submission can't bloat the answers jsonb.
      if (typeof value !== "string" || value.trim().length === 0) {
        return "Add your signature";
      }
      if (value.length > 200_000) return "Signature is too large";
      return null;
    }
    case "section":
    case "info":
      return null;
  }
}

/**
 * Validate a full submission. Unknown answer keys are dropped (stale schema
 * edits), so what's stored always matches the schema it was validated with.
 * Conditionally HIDDEN fields are skipped entirely — a hidden required field
 * never blocks submission, and its (stale) answer is dropped.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: FormAnswers,
): { ok: true; answers: FormAnswers } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const clean: FormAnswers = {};
  for (const field of visibleInputFields(schema, answers)) {
    const value = answers[field.id];
    const error = validateFieldAnswer(field, value);
    if (error) {
      errors[field.id] = error;
    } else if (value !== undefined && value !== null && value !== "") {
      clean[field.id] = value;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, answers: clean };
}

/** Human-readable answer for response tables, chat receipts, and workflows. */
export function formatAnswer(field: FormField, value: FormAnswerValue | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  switch (field.type) {
    case "select": {
      const opt = (field.options ?? []).find((o) => o.id === value);
      return opt?.label ?? String(value);
    }
    case "multi_select": {
      if (!Array.isArray(value)) return String(value);
      const byId = new Map((field.options ?? []).map((o) => [o.id, o.label]));
      return value
        .filter((v): v is string => typeof v === "string")
        .map((v) => byId.get(v) ?? v)
        .join(", ");
    }
    case "yes_no":
      return value === true ? "Yes" : "No";
    case "rating":
      return `${value}/${field.maxRating ?? 5}`;
    case "file": {
      if (!Array.isArray(value)) return String(value);
      const names = (value as FormFileValue[]).map((f) =>
        typeof f === "object" && f !== null ? f.name : String(f),
      );
      return names.join(", ") || "—";
    }
    case "signature":
      // Data URLs are unreadable in tables/templates; the responses view
      // renders the image itself.
      return typeof value === "string" && value.startsWith("data:image/")
        ? "✍ Signed"
        : String(value);
    default:
      // `people` answers are member ids — submitFormResponse resolves them to
      // names for the workflow payload the same way sourced selects resolve.
      return String(value);
  }
}

export function newFieldId(): string {
  return `f_${crypto.randomUUID().slice(0, 8)}`;
}

/** Display metadata for the builder palette and renderer. */
export const FIELD_TYPE_META: Record<
  FormFieldType,
  { label: string; description: string }
> = {
  short_text: { label: "Short answer", description: "A single line of text" },
  long_text: { label: "Long answer", description: "A paragraph of text" },
  email: { label: "Email", description: "An email address" },
  phone: { label: "Phone", description: "A phone number" },
  number: { label: "Number", description: "A numeric value" },
  select: { label: "Single choice", description: "Pick one option" },
  multi_select: { label: "Multiple choice", description: "Pick any that apply" },
  yes_no: { label: "Yes / No", description: "A simple toggle" },
  rating: { label: "Rating", description: "A 1–5 star scale" },
  date: { label: "Date", description: "A calendar date" },
  file: { label: "Attachment", description: "Upload photos or files" },
  section: { label: "Section", description: "A heading that groups fields" },
  people: { label: "People", description: "Pick a member of this property" },
  signature: { label: "Signature", description: "Draw or type a signature" },
  info: { label: "Information", description: "Read-only text between questions" },
};

/**
 * The task properties a form's answers actually populated, computed by
 * `submitFormResponse` from `taskProperty` mappings and carried on the
 * form.submitted payload as `task_properties`. Every key is always present
 * (null / empty when unmapped or unanswered) so `{{trigger.task_properties.*}}`
 * template refs resolve deterministically.
 */
export type FormTaskProperties = {
  assignee_id: string | null;
  priority: "urgent" | "high" | "medium" | "low" | null;
  due_at: string | null;
  labels: string[];
};

export function computeTaskProperties(
  schema: FormSchema,
  answers: FormAnswers,
  /** Optional per-field id→label maps for sourced choice answers. */
  labelsByField?: Map<string, Map<string, string>>,
): FormTaskProperties {
  const out: FormTaskProperties = {
    assignee_id: null,
    priority: null,
    due_at: null,
    labels: [],
  };
  for (const field of visibleInputFields(schema, answers)) {
    if (!field.taskProperty) continue;
    const value = answers[field.id];
    switch (field.taskProperty) {
      case "assignee":
        if (typeof value === "string" && value) out.assignee_id = value;
        break;
      case "priority": {
        const p = typeof value === "string" ? value : null;
        if (p === "urgent" || p === "high" || p === "medium" || p === "low") {
          out.priority = p;
        }
        break;
      }
      case "due_date":
        // "YYYY-MM-DD" from the date input — Postgres parses it into the
        // timestamptz due_at column directly.
        if (typeof value === "string" && value) out.due_at = value;
        break;
      case "labels": {
        const ids = Array.isArray(value)
          ? value.filter((v): v is string => typeof v === "string")
          : typeof value === "string" && value
            ? [value]
            : [];
        if (ids.length === 0) break;
        const resolved = labelsByField?.get(field.id);
        const byOption = new Map((field.options ?? []).map((o) => [o.id, o.label]));
        out.labels = ids.map((id) => resolved?.get(id) ?? byOption.get(id) ?? id);
        break;
      }
    }
  }
  return out;
}

/** Display metadata for the builder's data-source picker. */
export const SOURCE_KIND_META: Record<
  FormSourceKind,
  { label: string; description: string }
> = {
  members: { label: "Members", description: "People in this property" },
  projects: { label: "Projects", description: "Active projects" },
  tasks: { label: "Tasks", description: "Recently updated tasks" },
  spaces: { label: "Spaces", description: "Teams and spaces" },
  labels: { label: "Labels", description: "Workspace labels" },
  sheet_column: {
    label: "Spreadsheet column",
    description: "Values from a column in a sheet document",
  },
};
