import type { TaskStatus } from "@/lib/db/types";
import {
  isDone,
  isStarted as isStartedRow,
  type StatusLike,
} from "@/lib/tasks/statuses";

/**
 * Cycle scope math (Linear's model). Scope is measured in POINTS: a task's
 * `estimate`, with an unestimated task counting as 1 so a team that never
 * estimates still gets a meaningful burn-up (it degrades to issue counts).
 * An explicit 0 stays 0.
 *
 * started   = in_progress or blocked (work is open on it)
 * completed = done
 *
 * Client-safe — no server imports.
 */

/** The estimate scale offered by the pickers (Fibonacci, Linear's default). */
export const ESTIMATE_SCALE = [0, 1, 2, 3, 5, 8, 13] as const;

export type ScopeTask = StatusLike & { estimate: number | null };

export function taskPoints(estimate: number | null | undefined): number {
  return estimate ?? 1;
}

/** Legacy-literal form of `isStarted` (0114: category `active`). */
export function isStarted(status: TaskStatus) {
  return isStartedRow({ status });
}

export type ScopeStats = {
  /** Points in the cycle. */
  scope: number;
  started: number;
  completed: number;
  /** Task counts, for "N completed" captions. */
  count: number;
  startedCount: number;
  completedCount: number;
};

export const EMPTY_STATS: ScopeStats = {
  scope: 0,
  started: 0,
  completed: 0,
  count: 0,
  startedCount: 0,
  completedCount: 0,
};

export function scopeStats(tasks: Iterable<ScopeTask>): ScopeStats {
  const s = { ...EMPTY_STATS };
  for (const t of tasks) {
    const p = taskPoints(t.estimate);
    s.scope += p;
    s.count++;
    if (isDone(t)) {
      s.completed += p;
      s.completedCount++;
    } else if (isStartedRow(t)) {
      s.started += p;
      s.startedCount++;
    }
  }
  return s;
}

/** Whole-number percentage; 0 when there is nothing to measure against. */
export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/** Linear's "% success" for a finished cycle: completed share of final scope. */
export function successPct(stats: ScopeStats): number {
  return pct(stats.completed, stats.scope);
}

/**
 * Capacity = the team's recent throughput: the average completed points of
 * the last three finished cycles (`recentCompleted` is most-recent-first).
 * `pct` is how full the current cycle is against it — >100 means the team
 * has planned more than it has historically finished.
 */
export function capacity(
  currentScope: number,
  recentCompleted: number[],
): { average: number | null; pct: number | null } {
  const last = recentCompleted.slice(0, 3);
  if (last.length === 0) return { average: null, pct: null };
  const average = last.reduce((a, b) => a + b, 0) / last.length;
  if (average <= 0) return { average: 0, pct: null };
  return { average, pct: pct(currentScope, average) };
}

export type BreakdownRow = {
  key: string;
  scope: number;
  completed: number;
  count: number;
  /** Completed share of this group's scope. */
  pct: number;
};

/**
 * Group tasks for the detail page's Assignees / Labels / Priority / Projects
 * / Teams tabs. `keysOf` may return several keys (a task with two labels
 * counts in both groups) or none — callers map "no value" to a sentinel key
 * they render as "No assignee" etc. Sorted by scope, largest first.
 */
export function breakdown<T extends ScopeTask>(
  tasks: Iterable<T>,
  keysOf: (t: T) => string[],
): BreakdownRow[] {
  const groups = new Map<string, BreakdownRow>();
  for (const t of tasks) {
    const p = taskPoints(t.estimate);
    for (const key of new Set(keysOf(t))) {
      let g = groups.get(key);
      if (!g) {
        g = { key, scope: 0, completed: 0, count: 0, pct: 0 };
        groups.set(key, g);
      }
      g.scope += p;
      g.count++;
      if (isDone(t)) g.completed += p;
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, pct: pct(g.completed, g.scope) }))
    .sort((a, b) => b.scope - a.scope || a.key.localeCompare(b.key));
}
