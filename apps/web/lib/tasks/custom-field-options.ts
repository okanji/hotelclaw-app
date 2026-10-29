import { LABEL_COLORS } from "@/components/labels/label-tokens";
import type {
  CustomFieldOption,
  CustomFieldType,
  CustomFieldValue,
  EntityColor,
} from "@/lib/db/types";

/**
 * Shared helpers for the option list behind `select` (dropdown) and
 * `multi_select` (label) custom fields — used by the task sidebar, the field
 * manager, the board filters and the list view, so option colours and the
 * paste-a-column parsing behave identically everywhere.
 */

/** Field types whose value comes from `options`. */
export function isChoiceField(type: CustomFieldType): boolean {
  return type === "select" || type === "multi_select";
}

/** Human name per type — `multi_select` must never surface as raw snake_case. */
export const FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Money",
  select: "Dropdown",
  multi_select: "Labels",
  date: "Date",
  checkbox: "Checkbox",
  url: "Website",
  email: "Email",
  phone: "Phone",
  people: "People",
  files: "Files",
  relation: "Relationship",
  progress: "Progress",
};

/** The creatable types, in the order the "New field" picker lists them. */
export const FIELD_TYPE_ORDER: CustomFieldType[] = [
  "text",
  "long_text",
  "number",
  "currency",
  "select",
  "multi_select",
  "date",
  "checkbox",
  "people",
  "files",
  "relation",
  "url",
  "email",
  "phone",
  "progress",
];

/** One-line hint per type for the picker. */
export const FIELD_TYPE_HINT: Record<CustomFieldType, string> = {
  text: "A short line of text",
  long_text: "Paragraphs — notes, specs",
  number: "A plain number",
  currency: "An amount in KES, USD, EUR…",
  select: "Pick one option",
  multi_select: "Pick several options",
  date: "A calendar day",
  checkbox: "Yes or no",
  url: "A web link",
  email: "An email address",
  phone: "A phone number",
  people: "One or more members",
  files: "A named file slot — Quote, LPO, GRN",
  relation: "Links to other tasks",
  progress: "Done sub-issues and checklist items",
};

/** Currency codes offered first in the picker (Temple Point's three lead). */
export const COMMON_CURRENCIES = ["KES", "USD", "EUR", "GBP", "TZS", "UGX", "ZAR", "AED", "INR"];

/** "KES 1,250.00" — Intl when the code is real, a plain prefix otherwise. */
export function formatCurrency(
  amount: number,
  config?: { code?: string; precision?: number } | null,
): string {
  const precision =
    typeof config?.precision === "number" && config.precision >= 0 && config.precision <= 4
      ? config.precision
      : 2;
  const code = (config?.code ?? "").toUpperCase();
  const num = amount.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return code ? `${code} ${num}` : num;
}

/**
 * The colour an option renders in. Options created before 0099 have none, so
 * we fall back to a deterministic slot from the shared palette — stable for a
 * given option id, so a chip never changes colour between renders (Notion
 * assigns a colour at creation; this is the same idea, computed).
 */
export function optionColor(option: CustomFieldOption): EntityColor {
  if (option.color) return option.color;
  let hash = 0;
  for (let i = 0; i < option.id.length; i++) {
    hash = (hash * 31 + option.id.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length]!;
}

/** The next palette colour for a new option, cycling past what's in use. */
export function nextOptionColor(existing: CustomFieldOption[]): EntityColor {
  return LABEL_COLORS[existing.length % LABEL_COLORS.length]!;
}

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // A label of only punctuation would slug to "" — fall back to something
  // stable rather than colliding every such option onto one id.
  return slug || `opt-${label.length}-${label.charCodeAt(0) || 0}`;
}

/**
 * Parse a user's option list. Splits on NEWLINES first so a column pasted
 * from a spreadsheet lands one option per row (ClickUp's bulk-paste
 * behaviour), and on commas otherwise so the old comma-separated habit still
 * works. Existing options are matched by label so their `id` — which stored
 * task values point at — and their colour survive an edit.
 */
export function parseOptionsInput(
  text: string,
  existing: CustomFieldOption[] = [],
): CustomFieldOption[] {
  const raw = text.includes("\n") ? text.split("\n") : text.split(",");
  const labels = raw.map((s) => s.trim()).filter(Boolean);

  const byLabel = new Map(existing.map((o) => [o.label.toLowerCase(), o]));
  const usedIds = new Set<string>();
  const out: CustomFieldOption[] = [];

  for (const label of labels) {
    const kept = byLabel.get(label.toLowerCase());
    if (kept && !usedIds.has(kept.id)) {
      usedIds.add(kept.id);
      out.push(kept);
      continue;
    }
    let id = slugify(label);
    // Two distinct labels can slug to the same id ("Front desk" / "front-desk").
    // Values are keyed by id, so a collision would silently merge them.
    let n = 2;
    while (usedIds.has(id)) id = `${slugify(label)}-${n++}`;
    usedIds.add(id);
    out.push({ id, label, color: nextOptionColor(out) });
  }
  return out;
}

/** Serialize options back into the textarea form used by the editors. */
export function optionsToText(options: CustomFieldOption[]): string {
  return options.map((o) => o.label).join("\n");
}

/**
 * A single new option with a collision-safe id — the structured editor's
 * unit of work (the manager renames existing options IN PLACE by id, so the
 * label-matching of `parseOptionsInput` only applies to create-time bulk
 * entry, never to edits of a field that already has stored values).
 */
export function newOption(
  label: string,
  existing: CustomFieldOption[],
): CustomFieldOption {
  const usedIds = new Set(existing.map((o) => o.id));
  let id = slugify(label);
  let n = 2;
  while (usedIds.has(id)) id = `${slugify(label)}-${n++}`;
  return { id, label, color: nextOptionColor(existing) };
}

/**
 * Every option id currently set on a task, whatever the field type — a label
 * field stores an array, a dropdown a bare id. Callers that just want "which
 * chips do I draw" never have to branch on the type.
 */
export function valueOptionIds(value: CustomFieldValue | null): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

/** The options a value resolves to, in definition order, unknown ids dropped. */
export function selectedOptions(
  field: { options: CustomFieldOption[] },
  value: CustomFieldValue | null,
): CustomFieldOption[] {
  const ids = valueOptionIds(value);
  if (ids.length === 0) return [];
  return field.options.filter((o) => ids.includes(o.id));
}

/**
 * Plain-text rendering of a field value — the sort key for list columns and
 * the fallback for anywhere a chip can't be drawn.
 */
export function formatFieldValue(
  field: {
    type: CustomFieldType;
    options: CustomFieldOption[];
    config?: { code?: string; precision?: number } | null;
  },
  value: CustomFieldValue | null,
  ctx?: {
    /** member id → name (people). */
    names?: Record<string, { name?: string } | undefined>;
    /** task id → title (relation). */
    taskTitles?: Record<string, string | undefined>;
    /** attachment id → file name (files). */
    fileNames?: Record<string, string | undefined>;
  },
): string {
  if (value === null || value === undefined) return "";
  if (isChoiceField(field.type)) {
    return selectedOptions(field, value)
      .map((o) => o.label)
      .join(", ");
  }
  if (field.type === "checkbox") return value === true ? "Yes" : "No";
  if (field.type === "currency" && typeof value === "number") {
    return formatCurrency(value, field.config);
  }
  if (Array.isArray(value)) {
    const lookup =
      field.type === "people"
        ? (id: string) => ctx?.names?.[id]?.name
        : field.type === "relation"
          ? (id: string) => ctx?.taskTitles?.[id]
          : field.type === "files"
            ? (id: string) => ctx?.fileNames?.[id]
            : () => undefined;
    const noun = field.type === "files" ? "file" : field.type === "relation" ? "task" : "person";
    const named = value.map((id) => lookup(id)).filter((s): s is string => !!s);
    if (named.length === value.length) return named.join(", ");
    return `${value.length} ${value.length === 1 ? noun : noun === "person" ? "people" : `${noun}s`}`;
  }
  return String(value);
}
