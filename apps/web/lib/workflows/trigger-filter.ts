import { explainCondition } from "./explain-expr";
import {
  parseCondition,
  serializeCondition,
  type Clause,
  type CondNode,
} from "./jsonlogic-codec";

/** Path used for “which label was added” filters on task.label_added. */
export const ADDED_LABELS_PATH = "trigger.added_labels";

// Type guard so the label helpers skip nested groups and narrow to Clause.
function isLabelClause(c: CondNode): c is Clause {
  return c.kind === "clause" && c.path === ADDED_LABELS_PATH && c.op === "is_any_of";
}

/** Labels pinned by the dedicated label picker (may be empty = any label). */
export function extractAddedLabelFilter(expr: unknown): string[] {
  const model = parseCondition(expr);
  if (!model) return [];
  const labels: string[] = [];
  for (const c of model.clauses) {
    if (!isLabelClause(c)) continue;
    for (const v of c.values) {
      const t = v.trim();
      if (t && !labels.includes(t)) labels.push(t);
    }
  }
  return labels;
}

/** Filter with label clauses removed — for the generic condition builder. */
export function stripAddedLabelFilter(expr: unknown): unknown | undefined {
  const model = parseCondition(expr);
  if (!model) return expr === undefined ? undefined : expr;
  const rest = model.clauses.filter((c) => !isLabelClause(c));
  if (rest.length === model.clauses.length) {
    return serializeCondition(model);
  }
  return serializeCondition({ ...model, clauses: rest });
}

export function buildAddedLabelFilterExpr(labels: string[]): unknown | undefined {
  const trimmed = labels.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return undefined;
  return serializeCondition({
    combine: "all",
    clauses: [
      {
        kind: "clause",
        path: ADDED_LABELS_PATH,
        op: "is_any_of",
        value: "",
        values: trimmed,
        type: "string[]",
      },
    ],
  });
}

/** Merge dedicated label filter with additional conditions (AND). */
export function mergeTriggerFilter(
  labels: string[],
  additionalExpr: unknown | undefined,
): unknown | undefined {
  const labelExpr = buildAddedLabelFilterExpr(labels);
  const extra = stripAddedLabelFilter(additionalExpr);
  if (!labelExpr) return extra;
  if (!extra) return labelExpr;

  const labelModel = parseCondition(labelExpr);
  const extraModel = parseCondition(extra);
  if (!labelModel || !extraModel) {
    return { and: [labelExpr, extra] };
  }
  return serializeCondition({
    combine: "all",
    clauses: [...labelModel.clauses, ...extraModel.clauses],
  });
}

/* ── task.field_changed: which field, and which value ────────────────────── */

/**
 * The custom-field equivalent of the label picker above. `task.field_changed`
 * fires for EVERY field on every task, so a workflow almost always wants to
 * narrow it to one field ("Material status") and usually to one landing value
 * ("becomes LPO created") — which is exactly the shape ClickUp's "Custom Field
 * changes" trigger takes.
 *
 * Both clauses are ordinary conditions on the trigger payload, so the runtime
 * evaluator needs no special case: this is just a friendlier way to author
 * what the generic condition builder could already express.
 */
export const FIELD_NAME_PATH = "trigger.field_name";
/**
 * The landing-value clause matches on trigger.to_LABEL, not trigger.to: the
 * raw `to` is the stored jsonb (an option ID for select, an id ARRAY for
 * multi_select, a real boolean for checkbox) while the UI stores the human
 * label — `"lpo-created" == "LPO created"` never matched, so every "becomes
 * X" filter was dead until 2026-08-12 (migration 0101 guarantees the
 * enriched payload). `to_label` is the resolved label for select, "true"/
 * "false" text for checkbox, and the raw scalar text for text/number/date —
 * all string-comparable against what the picker stores.
 */
export const FIELD_TO_PATH = "trigger.to_label";
/**
 * multi_select needs membership, not equality: a task landing on
 * ["VIP","Rush"] must still match "becomes VIP". `to_labels` is the resolved
 * label array (0101); the clause serializes to `{in: [label, {var}]}`.
 */
export const FIELD_TO_LABELS_PATH = "trigger.to_labels";
/** Pre-0101 filters pointed at the raw value — recognized on read so old
 *  specs load into the picker, rewritten to the label paths on save. */
const LEGACY_FIELD_TO_PATH = "trigger.to";

export type FieldTriggerSelection = {
  /** Field NAME (the payload carries the name, so filters stay readable). */
  fieldName: string | null;
  /** Option label / value the field must land on; null = any change. */
  toValue: string | null;
  /** True for multi_select fields — "lands on" means "includes", so the
   *  clause is membership in to_labels rather than equality on to_label. */
  multi?: boolean;
};

/**
 * Deliberately a plain boolean rather than a type predicate: two predicate
 * calls on the same node in one expression narrow `CondNode` down to `never`
 * on the second, which TypeScript then refuses to read `.value` off.
 */
function isFieldClause(c: CondNode, path: string): boolean {
  return c.kind === "clause" && c.path === path && c.op === "==";
}

/** Any shape the landing-value clause has ever taken (label equality,
 *  multi-label membership, or the dead pre-0101 raw-value equality). */
function isFieldToClause(c: CondNode): boolean {
  if (c.kind !== "clause") return false;
  if (c.op === "==" && (c.path === FIELD_TO_PATH || c.path === LEGACY_FIELD_TO_PATH)) {
    return true;
  }
  return c.op === "is_any_of" && c.path === FIELD_TO_LABELS_PATH;
}

export function extractFieldTriggerFilter(expr: unknown): FieldTriggerSelection {
  const model = parseCondition(expr);
  if (!model) return { fieldName: null, toValue: null };
  let fieldName: string | null = null;
  let toValue: string | null = null;
  let multi = false;
  for (const c of model.clauses) {
    if (c.kind !== "clause") continue;
    if (c.op === "==" && c.path === FIELD_NAME_PATH) {
      fieldName = c.value || null;
    } else if (
      c.op === "==" &&
      (c.path === FIELD_TO_PATH || c.path === LEGACY_FIELD_TO_PATH)
    ) {
      toValue = c.value || null;
    } else if (c.op === "is_any_of" && c.path === FIELD_TO_LABELS_PATH) {
      toValue = c.values[0] || null;
      multi = true;
    }
  }
  return { fieldName, toValue, multi };
}

/** Filter with the field clauses removed — for the generic condition builder. */
export function stripFieldTriggerFilter(expr: unknown): unknown | undefined {
  const model = parseCondition(expr);
  if (!model) return expr === undefined ? undefined : expr;
  const rest = model.clauses.filter(
    (c) => !isFieldClause(c, FIELD_NAME_PATH) && !isFieldToClause(c),
  );
  if (rest.length === model.clauses.length) return serializeCondition(model);
  return serializeCondition({ ...model, clauses: rest });
}

export function buildFieldTriggerFilterExpr(
  selection: FieldTriggerSelection,
): unknown | undefined {
  const clauses: Clause[] = [];
  if (selection.fieldName) {
    clauses.push({
      kind: "clause",
      path: FIELD_NAME_PATH,
      op: "==",
      value: selection.fieldName,
      values: [],
      type: "string",
    });
  }
  // A landing value without a field would match that value on ANY field —
  // never what the author means, so it only counts alongside a field.
  if (selection.fieldName && selection.toValue) {
    clauses.push(
      selection.multi
        ? {
            kind: "clause",
            path: FIELD_TO_LABELS_PATH,
            op: "is_any_of",
            value: "",
            values: [selection.toValue],
            type: "string[]",
          }
        : {
            kind: "clause",
            path: FIELD_TO_PATH,
            op: "==",
            value: selection.toValue,
            values: [],
            type: "string",
          },
    );
  }
  if (clauses.length === 0) return undefined;
  return serializeCondition({ combine: "all", clauses });
}

/** Merge the dedicated field filter with additional conditions (AND). */
export function mergeFieldTriggerFilter(
  selection: FieldTriggerSelection,
  additionalExpr: unknown | undefined,
): unknown | undefined {
  const fieldExpr = buildFieldTriggerFilterExpr(selection);
  const extra = stripFieldTriggerFilter(additionalExpr);
  if (!fieldExpr) return extra;
  if (!extra) return fieldExpr;

  const fieldModel = parseCondition(fieldExpr);
  const extraModel = parseCondition(extra);
  if (!fieldModel || !extraModel) return { and: [fieldExpr, extra] };
  return serializeCondition({
    combine: "all",
    clauses: [...fieldModel.clauses, ...extraModel.clauses],
  });
}

function humanizeLabel(token: string): string {
  const words = token.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Plain-English summary for canvas cards and inspector previews. */
export function explainTriggerFilter(
  eventType: string,
  filterExpr: unknown | undefined,
  baseLabel?: string,
): string {
  const base = baseLabel ?? "this event";

  if (eventType === "task.label_added") {
    const labels = extractAddedLabelFilter(filterExpr);
    const extra = explainCondition(stripAddedLabelFilter(filterExpr));
    const hasExtra = extra && extra !== "a condition";

    if (labels.length === 1) {
      const name = humanizeLabel(labels[0]!);
      return hasExtra
        ? `When ${name} label is added · ${extra}`
        : `When ${name} label is added`;
    }
    if (labels.length > 1) {
      const names = labels.map(humanizeLabel).join(" or ");
      return hasExtra ? `When ${names} label is added · ${extra}` : `When ${names} label is added`;
    }
    if (hasExtra) return `When any label is added · ${extra}`;
    return "When any label is added";
  }

  if (eventType === "task.field_changed") {
    const { fieldName, toValue } = extractFieldTriggerFilter(filterExpr);
    const extra = explainCondition(stripFieldTriggerFilter(filterExpr));
    const hasExtra = extra && extra !== "a condition";

    let headline = "When any custom field changes";
    if (fieldName && toValue) headline = `When ${fieldName} becomes ${toValue}`;
    else if (fieldName) headline = `When ${fieldName} changes`;
    return hasExtra ? `${headline} · ${extra}` : headline;
  }

  if (filterExpr === undefined || filterExpr === null) {
    return base;
  }
  const explained = explainCondition(filterExpr);
  if (!explained || explained === "a condition") return base;
  return `${base} · ${explained}`;
}

/** Short tokens to show as chips on the trigger canvas card. */
export function triggerFilterChips(
  eventType: string,
  filterExpr: unknown | undefined,
): string[] {
  const chips: string[] = [];
  if (eventType === "task.label_added") {
    const labels = extractAddedLabelFilter(filterExpr);
    if (labels.length > 0) {
      for (const l of labels) chips.push(humanizeLabel(l));
    }
    const extra = explainCondition(stripAddedLabelFilter(filterExpr));
    if (extra && extra !== "a condition") chips.push(extra);
    return chips;
  }

  if (eventType === "task.field_changed") {
    const { fieldName, toValue } = extractFieldTriggerFilter(filterExpr);
    if (fieldName) chips.push(fieldName);
    if (toValue) chips.push(`→ ${toValue}`);
    const extra = explainCondition(stripFieldTriggerFilter(filterExpr));
    if (extra && extra !== "a condition") chips.push(extra);
    return chips;
  }

  const extra = explainCondition(stripAddedLabelFilter(filterExpr));
  if (extra && extra !== "a condition") chips.push(extra);
  return chips;
}
