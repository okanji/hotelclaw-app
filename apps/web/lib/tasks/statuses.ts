import type { EntityColor, StatusCategory, TaskStatus } from "@/lib/db/types";

/**
 * The status catalog — the ONE place on the web that knows what a task's
 * status means (migration 0114, ClickUp parity).
 *
 * A task's truth is `status_id` → a `statuses` row (name, category, blocked
 * flag, color) inside the `status_sets` row its LIST points at. The legacy
 * `status` literal (`todo|in_progress|blocked|done`) is a category projection
 * the DB maintains; everything here falls back to it when a row predates the
 * catalog (old caches, mobile), so predicates never go wrong on a partial row.
 *
 * Mirrors in SQL that MUST stay in step (statuses.test.ts parses the
 * migration): `legacy_status_of` ↔ `legacyOf`, `resolve_legacy_status` ↔
 * `statusForLegacy`, and the resolver's remap-on-list-move ↔ `remapForSet`.
 *
 * Client-safe — no server imports.
 */

export type { StatusCategory };

export const STATUS_CATEGORIES: StatusCategory[] = [
  "open",
  "unstarted",
  "active",
  "done",
  "closed",
];

export type StatusRow = {
  id: string;
  status_set_id: string;
  property_id: string;
  name: string;
  category: StatusCategory;
  is_blocked: boolean;
  color: EntityColor;
  position: number;
  archived_at: string | null;
};

export type StatusSetRow = {
  id: string;
  property_id: string;
  name: string;
  is_default: boolean;
  archived_at: string | null;
};

export type ListRow = {
  id: string;
  property_id: string;
  space_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: EntityColor;
  position: number;
  status_set_id: string;
  inherits_statuses: boolean;
  is_default: boolean;
  archived_at: string | null;
};

/** What `GET /api/properties/:id/lists` returns and the layout prefetches. */
export type StatusCatalogPayload = {
  lists: ListRow[];
  statusSets: StatusSetRow[];
  statuses: StatusRow[];
};

// ── Categories ──────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<
  StatusCategory,
  {
    label: string;
    /** The 0001 literal this category projects to (blocked handled by `legacyOf`). */
    legacy: TaskStatus;
    /** Default swatch for a new status of this category. */
    color: EntityColor;
    /** Glyph family `StatusIcon` draws: empty circle, dashed, half, bar, check. */
    glyph: "circle" | "dashed" | "half" | "bar" | "check";
  }
> = {
  open: { label: "Not started", legacy: "todo", color: "slate", glyph: "circle" },
  unstarted: { label: "Not started", legacy: "todo", color: "slate", glyph: "dashed" },
  active: { label: "Active", legacy: "in_progress", color: "blue", glyph: "half" },
  done: { label: "Done", legacy: "done", color: "green", glyph: "check" },
  closed: { label: "Closed", legacy: "done", color: "green", glyph: "check" },
};

/** The settings-dialog bands (Linear's layout): not started / active / done / closed. */
export const CATEGORY_BANDS: { label: string; categories: StatusCategory[] }[] = [
  { label: "Not started", categories: ["open", "unstarted"] },
  { label: "Active", categories: ["active"] },
  { label: "Done", categories: ["done"] },
  { label: "Closed", categories: ["closed"] },
];

/** category + blocked → legacy literal. Mirrors SQL `legacy_status_of`. */
export function legacyOf(
  s: Pick<StatusRow, "category" | "is_blocked">,
): TaskStatus {
  if (s.category === "active") return s.is_blocked ? "blocked" : "in_progress";
  return CATEGORY_META[s.category].legacy;
}

// ── Predicates: the only definition of "done-ness" on the web ───────────────

/** The minimum a row needs — a full `Task`, a `StatusRow`, or a legacy row. */
export type StatusLike = {
  status?: TaskStatus | string | null;
  status_category?: StatusCategory | null;
  status_blocked?: boolean | null;
};

function categoryOf(t: StatusLike): StatusCategory | null {
  if (t.status_category) return t.status_category;
  switch (t.status) {
    case "todo":
      return "open";
    case "in_progress":
    case "blocked":
      return "active";
    case "done":
      return "closed";
    default:
      return null;
  }
}

/** Finished: category done or closed (legacy: `done`). */
export function isDone(t: StatusLike): boolean {
  const c = categoryOf(t);
  return c === "done" || c === "closed";
}

/** Work is open on it: category active (legacy: in_progress | blocked). */
export function isStarted(t: StatusLike): boolean {
  return categoryOf(t) === "active";
}

/** Active AND flagged blocked (legacy: `blocked`). */
export function isBlocked(t: StatusLike): boolean {
  if (categoryOf(t) !== "active") return false;
  if (typeof t.status_blocked === "boolean") return t.status_blocked;
  return t.status === "blocked";
}

/** Not yet started: open or unstarted (legacy: `todo`). */
export function isNotStarted(t: StatusLike): boolean {
  const c = categoryOf(t);
  return c === "open" || c === "unstarted";
}

/** Category of a row, with the legacy fallback — for grouping/colour. */
export function statusCategoryOf(t: StatusLike): StatusCategory {
  return categoryOf(t) ?? "open";
}

const LEGACY_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** The status name to print — the pipeline name, else the legacy label. */
export function statusLabelOf(
  t: StatusLike & { status_name?: string | null },
): string {
  if (t.status_name) return t.status_name;
  return LEGACY_LABEL[t.status ?? ""] ?? String(t.status ?? "").replace(/_/g, " ");
}

// ── Set-level resolution (mirrors the SQL helpers) ──────────────────────────

function live(set: StatusRow[]): StatusRow[] {
  return set
    .filter((s) => !s.archived_at)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** First status of a set by (category, blocked). Mirrors `status_for_category`. */
export function statusForCategory(
  set: StatusRow[],
  category: StatusCategory,
  blocked = false,
): StatusRow | undefined {
  return live(set).find((s) => s.category === category && s.is_blocked === blocked);
}

/** Legacy literal → status of the set. Mirrors `resolve_legacy_status`. */
export function statusForLegacy(
  set: StatusRow[],
  legacy: TaskStatus | string,
): StatusRow | undefined {
  const open = statusForCategory(set, "open");
  switch (legacy) {
    case "todo":
      return open;
    case "in_progress":
      return statusForCategory(set, "active", false) ?? open;
    case "blocked":
      return (
        statusForCategory(set, "active", true) ??
        statusForCategory(set, "active", false) ??
        open
      );
    case "done":
      return statusForCategory(set, "closed") ?? statusForCategory(set, "done") ?? open;
    default:
      return open;
  }
}

/**
 * A status from another set → the closest status of `target` (list moves,
 * category-column drops). Mirrors the resolver's remap branch.
 */
export function remapForSet(
  from: Pick<StatusRow, "category" | "is_blocked">,
  target: StatusRow[],
): StatusRow | undefined {
  return (
    statusForCategory(target, from.category, from.is_blocked) ??
    (from.category === "active" && from.is_blocked
      ? statusForCategory(target, "active", false)
      : undefined) ??
    (from.category === "done" ? statusForCategory(target, "closed") : undefined) ??
    (from.category === "closed" ? statusForCategory(target, "done") : undefined) ??
    (from.category === "unstarted" ? statusForCategory(target, "open") : undefined) ??
    statusForCategory(target, "open")
  );
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RX.test(s);
}

/**
 * What a person, a bot, or a workflow typed → a status of the set: a uuid, an
 * exact (case-insensitive) name, a name prefix, or a legacy literal.
 */
export function resolveStatusInput(
  set: StatusRow[],
  input: string,
): StatusRow | undefined {
  const rows = live(set);
  const q = input.trim();
  if (!q) return undefined;
  if (isUuid(q)) return rows.find((s) => s.id === q);
  const lower = q.toLowerCase();
  const exact = rows.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;
  if (lower === "todo" || lower === "in_progress" || lower === "blocked" || lower === "done") {
    return statusForLegacy(rows, lower);
  }
  const loose = lower.replace(/[\s_-]+/g, "");
  const normalized = rows.find((s) => s.name.toLowerCase().replace(/[\s_-]+/g, "") === loose);
  if (normalized) return normalized;
  const prefix = rows.filter((s) => s.name.toLowerCase().startsWith(lower));
  return prefix.length === 1 ? prefix[0] : undefined;
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export type StatusCatalog = {
  lists: ListRow[];
  sets: Map<string, StatusSetRow>;
  statuses: Map<string, StatusRow>;
  listById(id: string): ListRow | undefined;
  /** Ordered live statuses of a set. */
  statusesOfSet(setId: string): StatusRow[];
  /** Ordered live statuses of the list's effective set. */
  statusesOfList(listId: string): StatusRow[];
  /** The `open` status — where new tasks land. */
  defaultStatusOf(listId: string): StatusRow | undefined;
  /** The `closed` status (fallback `done`) — "Mark all done". */
  closedStatusOf(listId: string): StatusRow | undefined;
  /** Live lists of a space (null = property-level), ordered. */
  listsOfSpace(spaceId: string | null): ListRow[];
  defaultListOf(spaceId: string | null): ListRow | undefined;
  /** The property-level catch-all. */
  generalList(): ListRow | undefined;
};

export function buildCatalog(payload: StatusCatalogPayload): StatusCatalog {
  const sets = new Map(payload.statusSets.map((s) => [s.id, s]));
  const statuses = new Map(payload.statuses.map((s) => [s.id, s]));
  const bySet = new Map<string, StatusRow[]>();
  for (const s of payload.statuses) {
    if (s.archived_at) continue;
    const arr = bySet.get(s.status_set_id) ?? [];
    arr.push(s);
    bySet.set(s.status_set_id, arr);
  }
  for (const arr of bySet.values()) {
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }
  const lists = [...payload.lists].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const listById = new Map(lists.map((l) => [l.id, l]));

  const statusesOfSet = (setId: string) => bySet.get(setId) ?? [];
  const statusesOfList = (listId: string) => {
    const list = listById.get(listId);
    return list ? statusesOfSet(list.status_set_id) : [];
  };
  const listsOfSpace = (spaceId: string | null) =>
    lists.filter((l) => !l.archived_at && l.space_id === spaceId);

  return {
    lists,
    sets,
    statuses,
    listById: (id) => listById.get(id),
    statusesOfSet,
    statusesOfList,
    defaultStatusOf: (listId) => statusForCategory(statusesOfList(listId), "open"),
    closedStatusOf: (listId) =>
      statusForCategory(statusesOfList(listId), "closed") ??
      statusForCategory(statusesOfList(listId), "done"),
    listsOfSpace,
    defaultListOf: (spaceId) => listsOfSpace(spaceId).find((l) => l.is_default),
    generalList: () => lists.find((l) => l.space_id === null && l.is_default),
  };
}

export const EMPTY_CATALOG: StatusCatalog = buildCatalog({
  lists: [],
  statusSets: [],
  statuses: [],
});

// ── Board columns ───────────────────────────────────────────────────────────

export type ColumnDef = {
  /** A status id (list scope) or a legacy literal (category scope). */
  id: string;
  label: string;
  color: EntityColor;
  category: StatusCategory;
  isBlocked: boolean;
  /** Soft WIP limit — the header count turns amber over it. */
  wipLimit: number | null;
};

/**
 * The four category columns every multi-list board shows. Ids ARE the legacy
 * literals, so a drop here is a legacy status write the DB resolves to the
 * first status of that category in the task's own list.
 */
export const CATEGORY_COLUMNS: ColumnDef[] = [
  { id: "todo", label: "To do", color: "slate", category: "open", isBlocked: false, wipLimit: null },
  { id: "in_progress", label: "In progress", color: "blue", category: "active", isBlocked: false, wipLimit: 5 },
  { id: "blocked", label: "Blocked", color: "amber", category: "active", isBlocked: true, wipLimit: 3 },
  { id: "done", label: "Done", color: "green", category: "closed", isBlocked: false, wipLimit: null },
];

export type BoardColumns = {
  scope: "list" | "category";
  listId: string | null;
  columns: ColumnDef[];
};

/** List scope → that list's pipeline; anything else → the category columns. */
export function columnsFor(catalog: StatusCatalog, listId: string | null): BoardColumns {
  if (listId) {
    const rows = catalog.statusesOfList(listId);
    if (rows.length > 0) {
      return {
        scope: "list",
        listId,
        columns: rows.map((s) => ({
          id: s.id,
          label: s.name,
          color: s.color,
          category: s.category,
          isBlocked: s.is_blocked,
          wipLimit: null,
        })),
      };
    }
  }
  return { scope: "category", listId: null, columns: CATEGORY_COLUMNS };
}

/**
 * What a status chip / picker trigger shows for `status` (a status id or a
 * legacy literal): the matching option of the task's pipeline, else the
 * flattened row fields the task carries, else the legacy category column.
 */
export function describeStatus(
  options: ColumnDef[],
  status: string,
  row?: StatusLike & { status_name?: string | null; status_color?: EntityColor | null },
): Pick<ColumnDef, "label" | "category" | "isBlocked" | "color"> {
  const option = options.find((c) => c.id === status);
  if (option) return option;
  if (row?.status_category) {
    return {
      label: row.status_name ?? statusLabelOf(row),
      category: row.status_category,
      isBlocked: row.status_blocked ?? false,
      color: row.status_color ?? CATEGORY_META[row.status_category].color,
    };
  }
  const legacy = CATEGORY_COLUMNS.find((c) => c.id === status);
  if (legacy) return legacy;
  return {
    label: statusLabelOf({ status }),
    category: "open",
    isBlocked: false,
    color: "slate",
  };
}

/** A column that holds finished work (hidden by "Hide done", no "Mark all done"). */
export function isDoneColumn(c: Pick<ColumnDef, "category">): boolean {
  return c.category === "done" || c.category === "closed";
}

/**
 * Where "Mark all done" sends a column's cards: the list's closed status
 * (fallback done) in list scope, the legacy literal in category scope.
 */
export function doneTargetFor(board: BoardColumns): string {
  if (board.scope === "list") {
    return (
      board.columns.find((c) => c.category === "closed")?.id ??
      board.columns.find((c) => c.category === "done")?.id ??
      "done"
    );
  }
  return "done";
}

/**
 * The optimistic row patch for a card dropped on `column`, so the card lands
 * and STAYS in that column until the refetch confirms it: `columnOfTask`
 * reads `status_id` first in list scope and `status_category` first in
 * category scope, so both must move together with the legacy literal.
 */
export function columnPatch(
  board: BoardColumns,
  column: ColumnDef,
): {
  status: TaskStatus;
  status_id?: string;
  status_name: string;
  status_category: StatusCategory;
  status_color: EntityColor;
  status_blocked: boolean;
} {
  const base = {
    status: legacyOf({ category: column.category, is_blocked: column.isBlocked }),
    status_name: column.label,
    status_category: column.category,
    status_color: column.color,
    status_blocked: column.isBlocked,
  };
  return board.scope === "list" ? { ...base, status_id: column.id } : base;
}

/** Which column a task sits in. Falls back by category so a stale row still lands. */
export function columnOfTask(
  board: BoardColumns,
  task: StatusLike & { status_id?: string | null },
): string {
  if (board.scope === "category") {
    const legacy = task.status_category
      ? legacyOf({
          category: task.status_category,
          is_blocked: task.status_blocked ?? task.status === "blocked",
        })
      : (task.status as TaskStatus | undefined);
    return legacy ?? "todo";
  }
  if (task.status_id && board.columns.some((c) => c.id === task.status_id)) {
    return task.status_id;
  }
  const cat = statusCategoryOf(task);
  const blocked = isBlocked(task);
  const match =
    board.columns.find((c) => c.category === cat && c.isBlocked === blocked) ??
    board.columns.find((c) => c.category === cat) ??
    board.columns[0];
  return match.id;
}
