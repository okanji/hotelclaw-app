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
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

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

export const FormFieldZod = z.object({
  id: z.string().min(1),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().min(1),
  /** Helper text under the label. */
  description: z.string().optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  /** For select / multi_select. */
  options: z.array(FormFieldOptionZod).optional(),
  /** For select / multi_select: populate options live from app data. */
  source: FormFieldSourceZod.optional(),
  /** For number: bounds. */
  min: z.number().optional(),
  max: z.number().optional(),
  /** For rating: scale size, 3–10 (default 5). */
  maxRating: z.number().int().min(3).max(10).optional(),
});

export const FormSchemaZod = z.object({
  version: z.literal(1),
  fields: z.array(FormFieldZod),
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
  return schema.fields.filter((f) => f.type !== "section");
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
    case "section":
      return null;
  }
}

/**
 * Validate a full submission. Unknown answer keys are dropped (stale schema
 * edits), so what's stored always matches the schema it was validated with.
 */
export function validateAnswers(
  schema: FormSchema,
  answers: FormAnswers,
): { ok: true; answers: FormAnswers } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const clean: FormAnswers = {};
  for (const field of inputFields(schema)) {
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
    default:
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
};

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
