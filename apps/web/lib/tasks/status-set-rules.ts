import type { EntityColor, StatusCategory } from "@/lib/db/types";
import { CATEGORY_META, remapForSet, type StatusRow } from "./statuses";

/**
 * The invariants of a status set (migration 0114), mirrored from the DB so
 * the editor can refuse BEFORE a write round-trips: exactly one `open` and
 * one `closed` status, names unique (case-insensitive), `is_blocked` only on
 * `active` rows. The DB enforces the same with partial unique indexes, a
 * CHECK and `statuses_guard_delete` — these are the friendly messages.
 *
 * Pure, client-safe, tested in `__tests__/status-set-rules.test.ts`.
 */

export type StatusDraft = Pick<
  StatusRow,
  "id" | "name" | "category" | "is_blocked" | "color" | "position"
>;

export type SetProblem =
  | { kind: "no_open" }
  | { kind: "many_open"; ids: string[] }
  | { kind: "no_closed" }
  | { kind: "many_closed"; ids: string[] }
  | { kind: "duplicate_name"; name: string; ids: string[] }
  | { kind: "blocked_not_active"; id: string }
  | { kind: "empty_name"; id: string };

export function problemMessage(p: SetProblem): string {
  switch (p.kind) {
    case "no_open":
      return "A pipeline needs one “not started” status — it's where new tasks land.";
    case "many_open":
      return "Only one status can be the entry point (category Not started). Make the others Unstarted.";
    case "no_closed":
      return "A pipeline needs one Closed status — it's where “Mark all done” sends work.";
    case "many_closed":
      return "Only one status can be Closed. Make the others Done.";
    case "duplicate_name":
      return `Two statuses are named “${p.name}”.`;
    case "blocked_not_active":
      return "Only an Active status can be marked blocked.";
    case "empty_name":
      return "Every status needs a name.";
  }
}

/** Every rule the set breaks (empty = valid). */
export function validateSet(rows: StatusDraft[]): SetProblem[] {
  const out: SetProblem[] = [];
  const open = rows.filter((r) => r.category === "open");
  const closed = rows.filter((r) => r.category === "closed");
  if (open.length === 0) out.push({ kind: "no_open" });
  if (open.length > 1) out.push({ kind: "many_open", ids: open.map((r) => r.id) });
  if (closed.length === 0) out.push({ kind: "no_closed" });
  if (closed.length > 1) out.push({ kind: "many_closed", ids: closed.map((r) => r.id) });
  const byName = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!key) {
      out.push({ kind: "empty_name", id: r.id });
      continue;
    }
    byName.set(key, [...(byName.get(key) ?? []), r.id]);
    if (r.is_blocked && r.category !== "active") {
      out.push({ kind: "blocked_not_active", id: r.id });
    }
  }
  for (const [, ids] of byName) {
    if (ids.length > 1) {
      const name = rows.find((r) => r.id === ids[0])!.name.trim();
      out.push({ kind: "duplicate_name", name, ids });
    }
  }
  return out;
}

/** Why a status can't be removed, or null when it can. */
export function deleteBlocker(rows: StatusDraft[], id: string): string | null {
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  if (rows.length <= 2) return "A pipeline needs at least a start and an end.";
  if (
    (row.category === "open" || row.category === "closed") &&
    !rows.some((r) => r.id !== id && r.category === row.category)
  ) {
    return row.category === "open"
      ? "This is the only “not started” status — pick another entry point first."
      : "This is the only Closed status — pick another one first.";
  }
  return null;
}

/**
 * Where the tasks of a deleted status go: the closest status of the rest of
 * the set, by category + blocked flag (the same rule as a list move).
 */
export function fallbackFor(
  rows: StatusDraft[],
  id: string,
): StatusDraft | undefined {
  const row = rows.find((r) => r.id === id);
  if (!row) return undefined;
  const rest = rows.filter((r) => r.id !== id);
  const asRows = rest.map(asStatusRow);
  const pick = remapForSet(row, asRows);
  return pick ? rest.find((r) => r.id === pick.id) : rest[0];
}

/** A row's position after the one it follows (or at the front / end). */
export function positionAfter(
  rows: StatusDraft[],
  afterId: string | null,
): number {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  if (afterId === null) {
    return sorted.length ? sorted[0].position - 1024 : 1024;
  }
  const idx = sorted.findIndex((r) => r.id === afterId);
  if (idx < 0) return (sorted.at(-1)?.position ?? 0) + 1024;
  const next = sorted[idx + 1];
  return next
    ? (sorted[idx].position + next.position) / 2
    : sorted[idx].position + 1024;
}

/** Positions for `orderedIds` as a clean 1024-step ladder. */
export function ladder(orderedIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  orderedIds.forEach((id, i) => {
    out[id] = (i + 1) * 1024;
  });
  return out;
}

/**
 * Forking a list off its inherited set: the rows to insert into the new
 * set (same names / categories / flags / colours / positions) and, per
 * source status id, the index of its copy — the server maps each task's
 * `status_id` to the copy at the same index, so nothing moves category.
 */
export function forkPlan(source: StatusDraft[]): {
  rows: Omit<StatusDraft, "id">[];
  indexOf: Record<string, number>;
} {
  const sorted = [...source].sort((a, b) => a.position - b.position);
  const indexOf: Record<string, number> = {};
  const rows = sorted.map((r, i) => {
    indexOf[r.id] = i;
    return {
      name: r.name,
      category: r.category,
      is_blocked: r.is_blocked,
      color: r.color,
      position: (i + 1) * 1024,
    };
  });
  return { rows, indexOf };
}

/**
 * Going back to the inherited set: per status of the list's own set, the
 * status of the target set its tasks remap to (by category + blocked).
 */
export function remapPlan(
  from: StatusDraft[],
  to: StatusDraft[],
): Record<string, string | undefined> {
  const target = to.map(asStatusRow);
  const out: Record<string, string | undefined> = {};
  for (const r of from) out[r.id] = remapForSet(r, target)?.id;
  return out;
}

/** A fresh status draft of a category, named after the category. */
export function newStatusDraft(
  category: StatusCategory,
  rows: StatusDraft[],
  over: Partial<StatusDraft> = {},
): Omit<StatusDraft, "id"> {
  const base = CATEGORY_META[category].label;
  const taken = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${base} ${i}`;
  const last = [...rows].sort((a, b) => a.position - b.position).at(-1);
  return {
    name,
    category,
    is_blocked: false,
    color: CATEGORY_META[category].color as EntityColor,
    position: (last?.position ?? 0) + 1024,
    ...over,
  };
}

function asStatusRow(r: StatusDraft): StatusRow {
  return { ...r, status_set_id: "", property_id: "", archived_at: null };
}
