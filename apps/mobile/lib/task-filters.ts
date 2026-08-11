import type { ApiTask, RecordSource, TaskPriority, TaskStatus } from "./api";

/**
 * Mobile task filtering, mirroring the web board's facets
 * (`apps/web/components/tasks/board-filters.tsx`). Kept pure so the sheet UI
 * and the list agree, and so the semantics can be checked against web's
 * without reading React.
 *
 * Every facet the web board has is here: search, status, priority, assignee,
 * creator, team, project, label, due bucket, source, and custom fields
 * (migration 0080). Facets are OR within a dimension and AND across
 * dimensions — Linear's model, matching web.
 */

export type DueBucket = "overdue" | "today" | "week" | "none";
export type SortBy = "manual" | "priority" | "due_at";

/** Sentinels, matching web's. `NONE` covers "no team" / "no project"; the
 *  FIELD_* pair covers has-a-value / is-empty on a custom field. */
export const UNASSIGNED = "__unassigned__";
export const NONE = "__none__";
export const FIELD_SET = "__set__";
export const FIELD_EMPTY = "__empty__";

export type TaskFilters = {
  search: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  assignees: string[];
  creators: string[];
  spaceIds: string[];
  projectIds: string[];
  due: DueBucket[];
  labels: string[];
  sources: RecordSource[];
  /** field id → selected values (option ids, "true"/"false", or a sentinel). */
  fieldValues: Record<string, string[]>;
  sortBy: SortBy;
};

export const EMPTY_TASK_FILTERS: TaskFilters = {
  search: "",
  statuses: [],
  priorities: [],
  assignees: [],
  creators: [],
  spaceIds: [],
  projectIds: [],
  due: [],
  labels: [],
  sources: [],
  fieldValues: {},
  sortBy: "manual",
};

export function activeFacetCount(f: TaskFilters): number {
  return (
    f.statuses.length +
    f.priorities.length +
    f.assignees.length +
    f.creators.length +
    f.spaceIds.length +
    f.projectIds.length +
    f.due.length +
    f.labels.length +
    f.sources.length +
    Object.values(f.fieldValues).reduce((n, v) => n + v.length, 0)
  );
}

/** Which due-buckets a task falls into — same arithmetic as web's
 *  `taskDueBuckets`, including "overdue only if not done". */
export function taskDueBuckets(task: ApiTask, now: number): DueBucket[] {
  if (!task.due_at) return ["none"];
  const t = Date.parse(task.due_at);
  if (Number.isNaN(t)) return ["none"];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startToday = start.getTime();
  const endToday = startToday + 86_400_000;
  const endWeek = startToday + 7 * 86_400_000;
  const out: DueBucket[] = [];
  if (t < startToday && task.status !== "done") out.push("overdue");
  if (t >= startToday && t < endToday) out.push("today");
  if (t >= startToday && t < endWeek) out.push("week");
  return out;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function applyTaskFilters(
  tasks: ApiTask[],
  filters: TaskFilters,
  now = Date.now(),
  /** task id → field id → value; absence of a key IS the "empty" signal. */
  fieldValues?: Map<string, Map<string, string>>,
): ApiTask[] {
  const needle = filters.search.trim().toLowerCase();

  const matched = tasks.filter((t) => {
    if (
      needle &&
      !t.title.toLowerCase().includes(needle) &&
      !(t.description ?? "").toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (filters.statuses.length && !filters.statuses.includes(t.status)) {
      return false;
    }
    if (filters.priorities.length && !filters.priorities.includes(t.priority)) {
      return false;
    }
    if (filters.assignees.length) {
      const key = t.assignee_id ?? UNASSIGNED;
      if (!filters.assignees.includes(key)) return false;
    }
    if (filters.due.length) {
      const buckets = taskDueBuckets(t, now);
      // Facets are OR within a dimension, AND across dimensions — Linear's
      // model, same as web.
      if (!buckets.some((b) => filters.due.includes(b))) return false;
    }
    if (filters.labels.length) {
      if (!(t.labels ?? []).some((l) => filters.labels.includes(l))) {
        return false;
      }
    }
    if (filters.creators.length && !filters.creators.includes(t.created_by ?? "")) {
      return false;
    }
    if (filters.spaceIds.length) {
      if (!filters.spaceIds.includes(t.space_id ?? NONE)) return false;
    }
    if (filters.projectIds.length) {
      if (!filters.projectIds.includes(t.project_id ?? NONE)) return false;
    }
    if (filters.sources.length && !filters.sources.includes(t.source)) {
      return false;
    }
    for (const [fieldId, wanted] of Object.entries(filters.fieldValues)) {
      if (!wanted.length) continue;
      const value = fieldValues?.get(t.id)?.get(fieldId);
      const has = value !== undefined && value !== "";
      const ok = wanted.some((w) =>
        w === FIELD_SET ? has : w === FIELD_EMPTY ? !has : value === w,
      );
      if (!ok) return false;
    }
    return true;
  });

  if (filters.sortBy === "priority") {
    return [...matched].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    );
  }
  if (filters.sortBy === "due_at") {
    return [...matched].sort((a, b) => {
      // Undated last, rather than sorting as epoch 0 at the top.
      const at = a.due_at ? Date.parse(a.due_at) : Number.POSITIVE_INFINITY;
      const bt = b.due_at ? Date.parse(b.due_at) : Number.POSITIVE_INFINITY;
      return at - bt;
    });
  }
  return matched;
}

/** Every distinct label across the loaded tasks — the facet's option list. */
export function labelOptions(tasks: ApiTask[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) for (const l of t.labels ?? []) set.add(l);
  return [...set].sort((a, b) => a.localeCompare(b));
}
