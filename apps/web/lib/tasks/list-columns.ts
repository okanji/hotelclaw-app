import type { Task } from "@/components/tasks/kanban";
import { PRIORITY_IDS, STATUS_IDS } from "@/components/tasks/kanban";
import type { CustomFieldRow } from "@/lib/query/custom-field-queries";
import { formatFieldValue } from "@/lib/tasks/custom-field-options";
import type {
  CustomFieldValue,
  TaskViewColumn,
  TaskViewSort,
} from "@/lib/db/types";

/**
 * The column model behind the tasks list view.
 *
 * Columns are addressed the same way the board's filter facets are: a
 * built-in key ("priority", "due", …) or `field:<uuid>` for a custom field.
 * The layout is stored per user in `task_view_columns` (migration 0099).
 *
 * Title is deliberately NOT in this list. Like ClickUp's Name column it is
 * always present, always first, and always the flexible one — a table you can
 * hide the task name from is a table you can't read.
 */

export const FIELD_COLUMN_PREFIX = "field:";

export function isFieldColumn(id: string): boolean {
  return id.startsWith(FIELD_COLUMN_PREFIX);
}

export function fieldColumnId(fieldId: string): string {
  return `${FIELD_COLUMN_PREFIX}${fieldId}`;
}

export function fieldIdOfColumn(id: string): string {
  return id.slice(FIELD_COLUMN_PREFIX.length);
}

export type BuiltinColumnDef = {
  id: string;
  label: string;
  /** Starting width in px; the user can drag it. */
  width: number;
  minWidth: number;
  /** Right-aligned numeric-ish columns read better in tabular figures. */
  sortable: boolean;
};

export const BUILTIN_COLUMNS: BuiltinColumnDef[] = [
  { id: "status", label: "Status", width: 130, minWidth: 90, sortable: true },
  { id: "priority", label: "Priority", width: 120, minWidth: 90, sortable: true },
  { id: "due", label: "Due", width: 130, minWidth: 90, sortable: true },
  { id: "assignee", label: "Assignee", width: 150, minWidth: 100, sortable: true },
  { id: "labels", label: "Tags", width: 180, minWidth: 100, sortable: true },
  { id: "project", label: "Project", width: 150, minWidth: 100, sortable: true },
  { id: "space", label: "Team", width: 140, minWidth: 100, sortable: true },
  { id: "created", label: "Created", width: 130, minWidth: 90, sortable: true },
  { id: "updated", label: "Updated", width: 130, minWidth: 90, sortable: true },
];

const BUILTIN_BY_ID = new Map(BUILTIN_COLUMNS.map((c) => [c.id, c]));

/** What a fresh workspace sees — the columns the list view always had. */
export const DEFAULT_COLUMNS: TaskViewColumn[] = [
  { id: "priority", width: 120 },
  { id: "due", width: 130 },
  { id: "assignee", width: 150 },
  { id: "updated", width: 130 },
];

/** Default width for a newly added custom-field column. */
export const DEFAULT_FIELD_WIDTH = 160;

export type ResolvedColumn = {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  sortable: boolean;
  /** Footer calculation, when the user picked one for this column. */
  calc?: ColumnCalc;
  /** Present when this column is a custom field. */
  field?: CustomFieldRow;
};

/**
 * Turn the stored layout into renderable columns.
 *
 * Unknown ids are dropped rather than repaired — a column for an archived or
 * deleted custom field should disappear, and re-adding the field re-adds the
 * column. Custom fields are never auto-added: like ClickUp, a new field shows
 * up in the "add column" panel, not in everyone's table.
 */
export function resolveColumns(
  stored: TaskViewColumn[],
  fields: CustomFieldRow[],
): ResolvedColumn[] {
  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const out: ResolvedColumn[] = [];
  const seen = new Set<string>();

  for (const col of stored) {
    if (col.hidden || seen.has(col.id)) continue;
    seen.add(col.id);

    if (isFieldColumn(col.id)) {
      const field = fieldById.get(fieldIdOfColumn(col.id));
      if (!field) continue;
      out.push({
        id: col.id,
        label: field.name,
        width: col.width || DEFAULT_FIELD_WIDTH,
        minWidth: 90,
        sortable: true,
        calc: parseCalc(col.calc),
        field,
      });
      continue;
    }

    const def = BUILTIN_BY_ID.get(col.id);
    if (!def) continue;
    out.push({
      id: def.id,
      label: def.label,
      width: col.width || def.width,
      minWidth: def.minWidth,
      sortable: def.sortable,
      calc: parseCalc(col.calc),
    });
  }
  return out;
}

/** Columns not currently on the table, for the "add column" panel. */
export function availableColumns(
  stored: TaskViewColumn[],
  fields: CustomFieldRow[],
): { builtins: BuiltinColumnDef[]; fields: CustomFieldRow[] } {
  const used = new Set(stored.filter((c) => !c.hidden).map((c) => c.id));
  return {
    builtins: BUILTIN_COLUMNS.filter((c) => !used.has(c.id)),
    fields: fields.filter((f) => !used.has(fieldColumnId(f.id))),
  };
}

/** The stored entry for a column being added. */
export function newColumnEntry(id: string): TaskViewColumn {
  if (isFieldColumn(id)) return { id, width: DEFAULT_FIELD_WIDTH };
  return { id, width: BUILTIN_BY_ID.get(id)?.width ?? 140 };
}

/* ── Sorting ─────────────────────────────────────────────────────────────── */

/**
 * Lookups a sort needs that don't live on the task row. Passed in rather than
 * fetched here so the comparator stays pure and testable.
 */
export type SortContext = {
  assigneeName: (id: string | null | undefined) => string;
  spaceName: (id: string | null | undefined) => string;
  /** task id → field id → raw stored value. */
  fieldValue: (taskId: string, fieldId: string) => CustomFieldValue | null;
};

/**
 * The comparable key for one cell. Empty values sort LAST in both directions —
 * an unset due date is not "earliest", it's absent, and burying blanks is what
 * every spreadsheet and ClickUp itself do.
 */
function sortKey(
  task: Task,
  column: ResolvedColumn,
  ctx: SortContext,
): string | number | null {
  if (column.field) {
    const raw = ctx.fieldValue(task.id, column.field.id);
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return raw;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    const text = formatFieldValue(column.field, raw);
    return text === "" ? null : text.toLowerCase();
  }

  switch (column.id) {
    case "status":
      return STATUS_IDS.indexOf(task.status);
    case "priority": {
      // PRIORITY_IDS is ["urgent", "high", "medium", "low"] — it deliberately
      // does NOT contain "none", so index order IS urgency order and
      // ascending reads Urgent → Low (ClickUp's priority sort). An unset
      // priority is a BLANK, not a rank: returning null buries it at the
      // bottom in both directions rather than letting indexOf's -1 float it
      // to the top on descending.
      const rank = PRIORITY_IDS.indexOf(task.priority);
      return rank < 0 ? null : rank;
    }
    case "due":
      return task.due_at ? new Date(task.due_at).getTime() : null;
    case "assignee": {
      const name = ctx.assigneeName(task.assignee_id);
      return name ? name.toLowerCase() : null;
    }
    case "labels": {
      const labels = task.labels ?? [];
      return labels.length ? labels.join(", ").toLowerCase() : null;
    }
    case "project":
      return task.project_name ? task.project_name.toLowerCase() : null;
    case "space": {
      const name = ctx.spaceName(task.space_id);
      return name ? name.toLowerCase() : null;
    }
    case "created":
      return task.created_at ? new Date(task.created_at).getTime() : null;
    case "updated":
      return new Date(task.updated_at).getTime();
    default:
      return null;
  }
}

export function compareBySort(
  a: Task,
  b: Task,
  column: ResolvedColumn,
  dir: "asc" | "desc",
  ctx: SortContext,
): number {
  const ka = sortKey(a, column, ctx);
  const kb = sortKey(b, column, ctx);

  // Blanks last, regardless of direction.
  if (ka === null && kb === null) return a.position - b.position;
  if (ka === null) return 1;
  if (kb === null) return -1;

  let cmp: number;
  if (typeof ka === "number" && typeof kb === "number") cmp = ka - kb;
  else cmp = String(ka).localeCompare(String(kb));

  if (cmp === 0) return a.position - b.position;
  return dir === "asc" ? cmp : -cmp;
}

/** Sort a group in place-safe fashion; null sort keeps manual order. */
export function sortTasks(
  tasks: Task[],
  sort: TaskViewSort,
  columns: ResolvedColumn[],
  ctx: SortContext,
): Task[] {
  if (!sort) return tasks;
  const column = columns.find((c) => c.id === sort.columnId);
  if (!column) return tasks;
  return [...tasks].sort((a, b) => compareBySort(a, b, column, sort.dir, ctx));
}

/* ── Column calculations (ClickUp's List-view footer) ────────────────────── */

/**
 * Per-column footer calculations. Numeric columns get the arithmetic set,
 * date columns earliest/latest, and every column can count — the same menu
 * ClickUp hangs off the bottom of each List column.
 */
export type ColumnCalc =
  | "count_values"
  | "count_empty"
  | "pct_not_empty"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest";

export const CALC_LABEL: Record<ColumnCalc, string> = {
  count_values: "Count values",
  count_empty: "Count empty",
  pct_not_empty: "% filled",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
  range: "Range",
  earliest: "Earliest",
  latest: "Latest",
};

const COUNT_CALCS: ColumnCalc[] = ["count_values", "count_empty", "pct_not_empty"];
const NUMBER_CALCS: ColumnCalc[] = ["sum", "avg", "min", "max", "range"];
const DATE_CALCS: ColumnCalc[] = ["earliest", "latest"];

const ALL_CALCS = new Set<string>([...COUNT_CALCS, ...NUMBER_CALCS, ...DATE_CALCS]);

function parseCalc(raw: string | undefined): ColumnCalc | undefined {
  return raw && ALL_CALCS.has(raw) ? (raw as ColumnCalc) : undefined;
}

function calcKind(column: ResolvedColumn): "number" | "date" | "other" {
  if (column.field) {
    if (column.field.type === "number") return "number";
    if (column.field.type === "date") return "date";
    return "other";
  }
  if (column.id === "due" || column.id === "created" || column.id === "updated") {
    return "date";
  }
  return "other";
}

/** The calculations this column's type supports, arithmetic first. */
export function calcsForColumn(column: ResolvedColumn): ColumnCalc[] {
  const kind = calcKind(column);
  if (kind === "number") return [...NUMBER_CALCS, ...COUNT_CALCS];
  if (kind === "date") return [...DATE_CALCS, ...COUNT_CALCS];
  return COUNT_CALCS;
}

function formatCalcNumber(n: number): string {
  // Sums of clean integers stay integers; anything fractional gets 2 dp.
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCalcDate(key: string | number): string {
  // Builtin date columns key as epoch ms; custom date fields as YYYY-MM-DD.
  const d = typeof key === "number" ? new Date(key) : new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(key);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Compute one column's footer value over the visible tasks. Pure — the same
 * `sortKey` the comparator uses supplies the cell values, so "empty" means
 * exactly what sorting means by it (blanks bury last there, count as empty
 * here). Returns null when the calc can't produce anything ("Sum" over no
 * numbers), which the footer renders as "—".
 */
export function computeColumnCalc(
  calc: ColumnCalc,
  column: ResolvedColumn,
  tasks: Task[],
  ctx: SortContext,
): string | null {
  const keys = tasks.map((t) => sortKey(t, column, ctx));
  const filled = keys.filter((k): k is string | number => k !== null);

  switch (calc) {
    case "count_values":
      return String(filled.length);
    case "count_empty":
      return String(keys.length - filled.length);
    case "pct_not_empty":
      return keys.length === 0
        ? null
        : `${Math.round((filled.length / keys.length) * 100)}%`;
    case "sum":
    case "avg":
    case "min":
    case "max":
    case "range": {
      const nums = filled.filter((k): k is number => typeof k === "number");
      if (nums.length === 0) return null;
      if (calc === "sum") return formatCalcNumber(nums.reduce((a, b) => a + b, 0));
      if (calc === "avg") {
        return formatCalcNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
      }
      if (calc === "min") return formatCalcNumber(Math.min(...nums));
      if (calc === "max") return formatCalcNumber(Math.max(...nums));
      return formatCalcNumber(Math.max(...nums) - Math.min(...nums));
    }
    case "earliest":
    case "latest": {
      if (filled.length === 0) return null;
      // Epoch numbers and ISO date strings both order correctly with the
      // default comparison within their own kind.
      const sorted = [...filled].sort((a, b) =>
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b)),
      );
      const pick = calc === "earliest" ? sorted[0]! : sorted[sorted.length - 1]!;
      return formatCalcDate(pick);
    }
  }
}
