/**
 * Lists + per-list status pipelines (web migration 0114), the phone's twin of
 * `apps/web/lib/tasks/statuses.ts`.
 *
 * A task row still carries the legacy `status` literal
 * (`todo | in_progress | blocked | done`) — the server derives it from the
 * status row's CATEGORY, so every older screen keeps working — and now also
 * `status_name` / `status_category` / `status_color` / `status_blocked` /
 * `list_id` / `completed_at`. Use the predicates here for "is finished" and
 * friends; never compare `status === "done"` in new code.
 */
import { useMemo } from "react";
import { useApi, type TaskStatus } from "./api";
import { STATUS_COLOR } from "../components/ui";

export type StatusCategory = "open" | "unstarted" | "active" | "done" | "closed";
export type EntityColor = "slate" | "blue" | "green" | "amber" | "rose" | "violet";

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

export type ListRow = {
  id: string;
  property_id: string;
  space_id: string | null;
  name: string;
  color: EntityColor | null;
  status_set_id: string;
  inherits_statuses: boolean;
  is_default: boolean;
  archived_at: string | null;
};

export type StatusCatalogPayload = {
  lists: ListRow[];
  statusSets: { id: string; name: string; is_default: boolean }[];
  statuses: StatusRow[];
};

export type StatusLike = {
  status?: TaskStatus | string | null;
  status_category?: StatusCategory | null;
  status_blocked?: boolean | null;
};

const LEGACY_CATEGORY: Record<string, StatusCategory> = {
  todo: "open",
  in_progress: "active",
  blocked: "active",
  done: "closed",
};

function categoryOf(t: StatusLike): StatusCategory | null {
  if (t.status_category) return t.status_category;
  return t.status ? (LEGACY_CATEGORY[t.status] ?? null) : null;
}

/** Finished: category done or closed (legacy `done`). */
export function isDone(t: StatusLike): boolean {
  const c = categoryOf(t);
  return c === "done" || c === "closed";
}

/** Work is open on it: category active (legacy in_progress | blocked). */
export function isStarted(t: StatusLike): boolean {
  return categoryOf(t) === "active";
}

/** Active AND flagged blocked (legacy `blocked`). */
export function isBlocked(t: StatusLike): boolean {
  if (categoryOf(t) !== "active") return false;
  if (typeof t.status_blocked === "boolean") return t.status_blocked;
  return t.status === "blocked";
}

/** Not yet started: open or unstarted (legacy `todo`). */
export function isNotStarted(t: StatusLike): boolean {
  const c = categoryOf(t);
  return c === "open" || c === "unstarted";
}

/** The legacy literal a category projects to — what the API still accepts. */
export function legacyOf(s: Pick<StatusRow, "category" | "is_blocked">): TaskStatus {
  if (s.category === "active") return s.is_blocked ? "blocked" : "in_progress";
  return s.category === "done" || s.category === "closed" ? "done" : "todo";
}

/** The EntityColor ramp as hex, close to the web tokens. */
export const ENTITY_HEX: Record<EntityColor, string> = {
  slate: "#64748b",
  blue: "#2563eb",
  green: "#16a34a",
  amber: "#d97706",
  rose: "#e11d48",
  violet: "#7c3aed",
};

/** Hex for a task's status: its own colour (0114) or the legacy ramp. */
export function statusHexOf(
  t: StatusLike & { status_color?: EntityColor | null },
): string {
  if (t.status_color && ENTITY_HEX[t.status_color]) return ENTITY_HEX[t.status_color];
  const legacy = (t.status ?? "todo") as TaskStatus;
  return STATUS_COLOR[legacy] ?? STATUS_COLOR.todo;
}

export type StatusCatalog = {
  lists: ListRow[];
  statuses: StatusRow[];
  listById: Map<string, ListRow>;
  /** Live statuses of a list, in pipeline order ([] when unknown). */
  statusesOfList: (listId: string | null | undefined) => StatusRow[];
};

export function buildCatalog(payload: StatusCatalogPayload | null | undefined): StatusCatalog {
  const lists = payload?.lists ?? [];
  const statuses = (payload?.statuses ?? [])
    .filter((s) => !s.archived_at)
    .sort((a, b) => a.position - b.position);
  const listById = new Map(lists.map((l) => [l.id, l] as const));
  const bySet = new Map<string, StatusRow[]>();
  for (const s of statuses) {
    const arr = bySet.get(s.status_set_id) ?? [];
    arr.push(s);
    bySet.set(s.status_set_id, arr);
  }
  return {
    lists,
    statuses,
    listById,
    statusesOfList: (listId) => {
      const list = listId ? listById.get(listId) : undefined;
      return list ? (bySet.get(list.status_set_id) ?? []) : [];
    },
  };
}

/**
 * The property's lists + pipelines from `GET /api/properties/:id/lists`
 * (Bearer-capable). Resolves to an empty catalog until it loads, so screens
 * fall back to the four legacy statuses meanwhile.
 */
export function useStatusCatalog(propertyId: string | null | undefined): StatusCatalog {
  const { data } = useApi<StatusCatalogPayload>(
    propertyId ? `/api/properties/${propertyId}/lists` : null,
  );
  return useMemo(() => buildCatalog(data), [data]);
}
