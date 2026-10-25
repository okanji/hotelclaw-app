import type { TaskStatus, UpdateHealth } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* Linear-parity planning math (migration 0111) — pure, no I/O, client-safe.  */
/*                                                                            */
/* Three reads the project / initiative surfaces share:                       */
/*   - health: a person's DECLARED call (latest update) beats the computed    */
/*     pace read; an initiative without its own update rolls up its projects. */
/*   - progress: Linear's Scope / Started / Completed, in estimate points.    */
/*   - milestone %: done tasks over all tasks tagged with the milestone.      */
/* -------------------------------------------------------------------------- */

/**
 * The computed pace read from `projectHealth` (tracking-shared.tsx). Mirrored
 * as a string union here so this module stays free of React imports.
 */
export type ComputedHealth = "none" | "on_track" | "at_risk" | "overdue" | "done";

/** Worst-first severity — a roll-up reports the worst thing it contains. */
const SEVERITY: Record<UpdateHealth, number> = {
  on_track: 0,
  at_risk: 1,
  off_track: 2,
};

/**
 * Map the computed pace read onto the declared vocabulary. `none` (no target
 * date) and `done` say nothing about risk, so they drop out of a roll-up.
 */
export function computedToDeclared(h: ComputedHealth): UpdateHealth | null {
  switch (h) {
    case "on_track":
      return "on_track";
    case "at_risk":
      return "at_risk";
    case "overdue":
      return "off_track";
    default:
      return null;
  }
}

/** Latest-wins over `{health, created_at}` rows; null when there are none. */
export function latestHealth(
  updates: { health: UpdateHealth; created_at: string }[],
): UpdateHealth | null {
  let best: { health: UpdateHealth; created_at: string } | null = null;
  for (const u of updates) {
    if (!best || u.created_at > best.created_at) best = u;
  }
  return best?.health ?? null;
}

/**
 * The health one project contributes to a roll-up: its declared call when a
 * person has posted one, else its computed pace read.
 */
export function effectiveProjectHealth(
  declared: UpdateHealth | null,
  computed: ComputedHealth,
): UpdateHealth | null {
  return declared ?? computedToDeclared(computed);
}

/** Worst of a set of healths; null when nothing in the set has an opinion. */
export function rollupHealth(
  healths: (UpdateHealth | null | undefined)[],
): UpdateHealth | null {
  let worst: UpdateHealth | null = null;
  for (const h of healths) {
    if (!h) continue;
    if (worst === null || SEVERITY[h] > SEVERITY[worst]) worst = h;
  }
  return worst;
}

export type InitiativeHealth = {
  health: UpdateHealth | null;
  /** Where the number came from — the UI labels a roll-up as such. */
  source: "declared" | "rollup" | "none";
};

/**
 * An initiative's health: its own latest update wins; otherwise the worst
 * effective health across its linked projects.
 */
export function initiativeHealth(
  declared: UpdateHealth | null,
  projectHealths: (UpdateHealth | null)[],
): InitiativeHealth {
  if (declared) return { health: declared, source: "declared" };
  const rolled = rollupHealth(projectHealths);
  return rolled ? { health: rolled, source: "rollup" } : { health: null, source: "none" };
}

/* ── Progress ─────────────────────────────────────────────────────────────── */

export type ProgressTask = {
  status: TaskStatus;
  estimate: number | null;
  assignee_id?: string | null;
};

export type ProgressStats = {
  /** Estimate points in scope (unestimated counts as 1). */
  scope: number;
  /** Points in flight: in progress or blocked. */
  started: number;
  /** Points done. */
  completed: number;
  /** Task counts, for the "N issues" captions. */
  tasks: number;
  doneTasks: number;
};

/** Linear's scope convention: an unestimated task still counts as one point. */
export function taskPoints(t: { estimate: number | null }): number {
  return t.estimate ?? 1;
}

export function progressStats(tasks: ProgressTask[]): ProgressStats {
  const s: ProgressStats = { scope: 0, started: 0, completed: 0, tasks: 0, doneTasks: 0 };
  for (const t of tasks) {
    const pts = taskPoints(t);
    s.scope += pts;
    s.tasks += 1;
    if (t.status === "done") {
      s.completed += pts;
      s.doneTasks += 1;
    } else if (t.status === "in_progress" || t.status === "blocked") {
      s.started += pts;
    }
  }
  return s;
}

/** Whole-number percent of `part` over `whole`; 0 when the whole is empty. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export type AssigneeProgress = ProgressStats & { assigneeId: string | null };

/**
 * Progress per assignee (null = unassigned), largest scope first, unassigned
 * last — the "Assignees" breakdown tab on Linear's project page.
 */
export function progressByAssignee(tasks: ProgressTask[]): AssigneeProgress[] {
  const groups = new Map<string | null, ProgressTask[]>();
  for (const t of tasks) {
    const key = t.assignee_id ?? null;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()]
    .map(([assigneeId, list]) => ({ assigneeId, ...progressStats(list) }))
    .sort((a, b) => {
      if (a.assigneeId === null) return 1;
      if (b.assigneeId === null) return -1;
      return b.scope - a.scope;
    });
}

/* ── Milestones ───────────────────────────────────────────────────────────── */

export type MilestoneProgress = { done: number; total: number; pct: number };

/**
 * Done / total over tasks tagged with each milestone (a COUNT, like Linear's
 * "67% of 3" — not points). Milestones with no tasks are absent from the map.
 */
export function milestoneProgress(
  tasks: { status: TaskStatus; milestone_id: string | null }[],
): Map<string, MilestoneProgress> {
  const out = new Map<string, MilestoneProgress>();
  for (const t of tasks) {
    if (!t.milestone_id) continue;
    const m = out.get(t.milestone_id) ?? { done: 0, total: 0, pct: 0 };
    m.total += 1;
    if (t.status === "done") m.done += 1;
    out.set(t.milestone_id, m);
  }
  for (const m of out.values()) m.pct = pct(m.done, m.total);
  return out;
}

/* ── Target labels ────────────────────────────────────────────────────────── */

/**
 * Linear writes initiative targets coarsely: "Q2 2027" when the date is a
 * quarter's last day, otherwise "Dec 2026" (month + year). Input is the
 * `YYYY-MM-DD` day column.
 */
export function formatTarget(dateOnly: string | null): string | null {
  if (!dateOnly) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month % 3 === 0 && day === lastDay) return `Q${month / 3} ${year}`;
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${label} ${year}`;
}
