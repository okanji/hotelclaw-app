"use client";

import { useMemo } from "react";
import { Clock } from "lucide-react";
import {
  pct,
  progressByAssignee,
  progressStats,
  type ProgressTask,
} from "@/lib/initiatives/planning";
import { isBlocked, isDone, isStarted } from "@/lib/tasks/statuses";
import type { TaskStatus } from "@/lib/db/types";
import { Gi } from "@/components/gr8r/icon";
import { Av, StIcon } from "@/components/gr8r/home-glyphs";
import { G8Panel } from "@/components/gr8r/project-page";

type Person = { id: string; name: string | null; avatarUrl: string | null };

/** The four category buckets, in gr8r's STATUSES order, with their ramp. */
const BUCKETS: { id: TaskStatus; label: string; c: string }[] = [
  { id: "todo", label: "To do", c: "var(--g8-st-todo)" },
  { id: "in_progress", label: "In progress", c: "var(--g8-st-progress)" },
  { id: "blocked", label: "Blocked", c: "var(--g8-red)" },
  { id: "done", label: "Done", c: "var(--g8-st-done)" },
];

function bucketOf(t: ProgressTask): TaskStatus {
  if (isDone(t)) return "done";
  if (isBlocked(t)) return "blocked";
  if (isStarted(t)) return "in_progress";
  return "todo";
}

/** Completed (solid) over started (soft) on one gr8r `.stackbar`. */
function ScopeBar({ scope, started, completed }: { scope: number; started: number; completed: number }) {
  return (
    <span
      className="stackbar"
      style={{ height: 6, flex: 1 }}
      role="img"
      aria-label={`${completed} of ${scope} points completed, ${started} started`}
    >
      {completed > 0 ? <i style={{ width: `${pct(completed, scope)}%`, background: "var(--g8-st-done)" }} /> : null}
      {started > 0 ? <i style={{ width: `${pct(started, scope)}%`, background: "var(--g8-st-progress)" }} /> : null}
    </span>
  );
}

/**
 * gr8r's Overview "Progress" panel (src/views/project-overview.js — big %,
 * days to the due date, overdue badge, a status `.stackbar`, per-status
 * tallies) carrying our Linear-parity numbers: Scope / Started / Completed
 * in estimate points (an unestimated task counts as 1 —
 * `lib/initiatives/planning.ts`) and the same per assignee.
 */
export function ProjectProgressBlock({
  tasks,
  people,
  targetDate,
  overdue = 0,
  health,
  onBucket,
}: {
  tasks: ProgressTask[];
  people: Person[];
  /** `projects.target_date` — "N days until …" under the big number. */
  targetDate?: string | null;
  overdue?: number;
  /** Declared + pace health, shown in the panel header. */
  health?: React.ReactNode;
  /** A tally was clicked — the page opens its List tab. */
  onBucket?: (status: TaskStatus) => void;
}) {
  const stats = useMemo(() => progressStats(tasks), [tasks]);
  const rows = useMemo(() => progressByAssignee(tasks), [tasks]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { todo: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of tasks) c[bucketOf(t)] += 1;
    return c;
  }, [tasks]);

  const days = useMemo(() => {
    if (!targetDate) return null;
    const [y, m, d] = targetDate.slice(0, 10).split("-").map(Number);
    const target = new Date(y!, (m ?? 1) - 1, d ?? 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      n: Math.round((target.getTime() - today.getTime()) / 86_400_000),
      label: target.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    };
  }, [targetDate]);

  const done = pct(stats.doneTasks, stats.tasks);

  return (
    <G8Panel
      title="Progress"
      acts={
        <>
          {health}
          <span className="faint num" style={{ fontSize: 12 }}>
            {stats.doneTasks} of {stats.tasks} tasks done
          </span>
        </>
      }
    >
      {stats.tasks === 0 ? (
        <span className="faint">No tasks yet — scope and progress appear as work is added.</span>
      ) : (
        <>
          <div className="row" style={{ alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <span className="num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em" }}>
              {done}%
            </span>
            {days ? (
              <span className="muted">
                {days.n >= 0 ? `${days.n} days until ${days.label}` : `Ended ${days.label}`}
              </span>
            ) : null}
            {overdue > 0 ? (
              <span className="badge red">
                <Gi icon={Clock} size={11} />
                {overdue} overdue
              </span>
            ) : null}
          </div>
          <div className="stackbar" style={{ height: 8, marginBottom: 12 }}>
            {BUCKETS.map((b) =>
              counts[b.id] > 0 ? (
                <i
                  key={b.id}
                  style={{ width: `${(counts[b.id] / stats.tasks) * 100}%`, background: b.c }}
                  title={`${b.label}: ${counts[b.id]}`}
                />
              ) : null,
            )}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 14, fontSize: 12.5 }}>
            {BUCKETS.map((b) => (
              <button
                key={b.id}
                type="button"
                className="row"
                style={{ gap: 5 }}
                onClick={onBucket ? () => onBucket(b.id) : undefined}
              >
                <StIcon task={{ status: b.id }} size={12} />
                <span className="muted">{b.label}</span>
                <b className="num" style={{ fontWeight: 600 }}>
                  {counts[b.id]}
                </b>
              </button>
            ))}
          </div>

          {/* Points — Linear's Scope / Started / Completed. */}
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 16 }}>
            <PointStat label="Scope" value={stats.scope} sub={`${stats.tasks} ${stats.tasks === 1 ? "task" : "tasks"} · points`} />
            <PointStat label="Started" value={stats.started} sub={`${pct(stats.started, stats.scope)}%`} />
            <PointStat label="Completed" value={stats.completed} sub={`${pct(stats.completed, stats.scope)}%`} />
          </div>

          <div className="col" style={{ gap: 0, marginTop: 12 }}>
            {rows.map((r) => {
              const p = r.assigneeId ? byId.get(r.assigneeId) : undefined;
              const label = r.assigneeId ? (p?.name ?? "Former member") : "Unassigned";
              return (
                <div
                  key={r.assigneeId ?? "none"}
                  className="row"
                  style={{ minHeight: 34, gap: 10, borderTop: "1px solid var(--g8-divider)" }}
                >
                  <Av member={r.assigneeId ? (p ?? { id: r.assigneeId, name: label }) : null} />
                  <span
                    className={r.assigneeId ? "trunc" : "trunc muted"}
                    style={{ width: 140, flexShrink: 0, fontWeight: r.assigneeId ? 500 : 400 }}
                  >
                    {label}
                  </span>
                  <ScopeBar scope={r.scope} started={r.started} completed={r.completed} />
                  <span className="num muted" style={{ width: 52, textAlign: "right", flexShrink: 0, fontSize: 12.5 }}>
                    {r.completed}/{r.scope}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </G8Panel>
  );
}

function PointStat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="d">{sub}</div>
    </div>
  );
}
