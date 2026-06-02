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
  }
  const extra = explainCondition(stripAddedLabelFilter(filterExpr));
  if (extra && extra !== "a condition") chips.push(extra);
  return chips;
}
