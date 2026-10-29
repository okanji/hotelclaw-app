"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, IterationCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/page-header";
import { COLUMNS, PRIORITY_META } from "@/components/tasks/kanban";
import { Gi } from "@/components/gr8r/icon";
import { StIcon } from "@/components/gr8r/home-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import { cyclesHref } from "@/lib/query/cycle-queries";
import { buildBurnup, type HistoryEvent } from "@/lib/cycles/burnup";
import { diffDays, formatRange, type DateStr } from "@/lib/cycles/dates";
import { cycleLabel, cyclePhase } from "@/lib/cycles/plan";
import { breakdown, pct, type BreakdownRow } from "@/lib/cycles/scope";
import type { CycleRow, CycleTask } from "@/lib/cycles/types";
import type { TaskStatus } from "@/lib/db/types";
import { BurnupChart, BurnupLegend } from "./burnup-chart";
import { CycleTaskRow, useScopeLookups, type ScopeLookups } from "./cycle-task-row";
import { renameCycle } from "./actions";

/** Linear's cycle grouping: work in flight first, finished last. */
const STATUS_ORDER: TaskStatus[] = ["in_progress", "blocked", "todo", "done"];
const NONE = "__none__";

type BreakdownTab = "assignees" | "labels" | "priority" | "projects" | "teams";

/**
 * One cycle — Linear's cycle page. Left: the cycle's tasks grouped by
 * status (plus, for a finished cycle, the work that rolled over). Right: a
 * panel with the cycle's name + dates, Progress (scope / started /
 * completed), the burn-up, and Assignees / Labels / Priority / Projects /
 * Teams breakdowns, each row "X% of N".
 *
 * Progress and breakdowns are measured on the replayed snapshot (today, or
 * the cycle's last day once it has ended), so a finished cycle still counts
 * the tasks that moved on.
 */
export function CycleDetail({
  propertyId,
  cycle,
  siblings,
  tasks,
  events,
  today,
  timeZone,
  scopeName,
}: {
  propertyId: string;
  cycle: CycleRow;
  /** Every cycle of the same cadence, oldest first (prev/next + "moved to"). */
  siblings: CycleRow[];
  tasks: CycleTask[];
  events: HistoryEvent[];
  today: DateStr;
  timeZone: string;
  scopeName: string;
}) {
  const lookups = useScopeLookups(propertyId);
  const phase = cyclePhase(cycle, today);
  const refYear = Number(today.slice(0, 4));

  const burnup = useMemo(
    () =>
      buildBurnup({
        cycleId: cycle.id,
        startsOn: cycle.starts_on,
        endsOn: cycle.ends_on,
        today,
        timeZone,
        tasks,
        events,
      }),
    [cycle, today, timeZone, tasks, events],
  );

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const inCycle = tasks.filter((t) => t.cycle_id === cycle.id);
  // Members of the measured snapshot that have since left (rolled over or
  // moved by hand) — shown under their own heading so the list adds up to
  // the progress numbers.
  const movedOut = [...burnup.members.keys()]
    .map((id) => byId.get(id))
    .filter((t): t is CycleTask => !!t && t.cycle_id !== cycle.id);
  const siblingName = (id: string | null) => {
    const c = id ? siblings.find((s) => s.id === id) : null;
    return c ? cycleLabel(c) : "another cycle";
  };

  // Breakdowns read the snapshot's status/estimate on top of each task's
  // current metadata (assignee, labels, project, team).
  const snapshot = useMemo(
    () =>
      [...burnup.members.entries()].flatMap(([id, s]) => {
        const t = byId.get(id);
        return t ? [{ ...t, status: s.status, estimate: s.estimate }] : [];
      }),
    [burnup, byId],
  );

  const idx = siblings.findIndex((s) => s.id === cycle.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const s = burnup.stats;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: `Cycles · ${scopeName}`,
            href: cyclesHref(propertyId, cycle.space_id),
            icon: <IterationCcw />,
          },
          { label: cycleLabel(cycle) },
        ]}
        actions={
          <div className="row" style={{ gap: 2 }}>
            <NavButton
              propertyId={propertyId}
              target={prev}
              label="Previous cycle"
              icon={<Gi icon={ChevronLeft} size={15} />}
            />
            <NavButton
              propertyId={propertyId}
              target={next}
              label="Next cycle"
              icon={<Gi icon={ChevronRight} size={15} />}
            />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <main className="min-w-0 flex-1 lg:overflow-y-auto">
          <div className="page wide" style={{ paddingTop: 20 }}>
            {inCycle.length === 0 && movedOut.length === 0 ? (
              <div className="panel">
                <G8Empty
                  icon={IterationCcw}
                  title="Nothing planned yet"
                  text="Add tasks to this cycle from a task's Cycle property, or filter the board by cycle to see what's in it."
                />
              </div>
            ) : (
              <div className="stack">
                {STATUS_ORDER.map((status) => {
                  const rows = inCycle.filter((t) => t.status === status);
                  if (rows.length === 0) return null;
                  return (
                    <StatusGroup
                      key={status}
                      status={status}
                      count={rows.length}
                      points={rows.reduce((n, t) => n + (t.estimate ?? 1), 0)}
                    >
                      {rows.map((t) => (
                        <CycleTaskRow
                          key={t.id}
                          propertyId={propertyId}
                          task={t}
                          lookups={lookups}
                        />
                      ))}
                    </StatusGroup>
                  );
                })}
                {movedOut.length > 0 ? (
                  <section className="panel" style={{ overflow: "hidden" }}>
                    <div className="panel-h">
                      <h2>Moved on</h2>
                      <span className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
                        {movedOut.length}
                      </span>
                    </div>
                    <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {movedOut.map((t) => (
                        <CycleTaskRow
                          key={t.id}
                          propertyId={propertyId}
                          task={t}
                          lookups={lookups}
                          note={
                            t.cycle_id ? `Now in ${siblingName(t.cycle_id)}` : "Removed"
                          }
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </div>
        </main>

        <aside
          className="shrink-0 lg:w-[340px] lg:overflow-y-auto"
          style={{
            borderLeft: "1px solid var(--g8-border)",
            borderTop: "1px solid var(--g8-border)",
            background: "var(--g8-bg-side)",
            padding: "20px 18px",
          }}
        >
          <CycleName cycle={cycle} />
          <div className="row muted num" style={{ marginTop: 4, flexWrap: "wrap", fontSize: "var(--g8-fs-sm)" }}>
            {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
            <span
              className={
                phase === "current"
                  ? "badge accent"
                  : phase === "past"
                    ? "badge green"
                    : "badge gray"
              }
            >
              <span className="dot" />
              {phase === "current"
                ? `${diffDays(today, cycle.ends_on)}d left`
                : phase === "past"
                  ? "Completed"
                  : `Starts in ${diffDays(today, cycle.starts_on)}d`}
            </span>
          </div>

          <div className="eyebrow" style={{ margin: "24px 0 10px" }}>
            Progress
          </div>
          <dl className="grid grid-cols-3 gap-3" style={{ margin: 0 }}>
            <ProgressStat label="Scope" value={s.scope} />
            <ProgressStat
              label="Started"
              value={s.started}
              sub={`${pct(s.started, s.scope)}%`}
            />
            <ProgressStat
              label="Completed"
              value={s.completed}
              sub={`${pct(s.completed, s.scope)}%`}
            />
          </dl>

          {phase !== "upcoming" ? (
            <>
              <BurnupChart points={burnup.points} className="mt-5" />
              <BurnupLegend className="mt-2" />
            </>
          ) : null}

          <Breakdowns snapshot={snapshot} lookups={lookups} />
        </aside>
      </div>
    </div>
  );
}

function NavButton({
  propertyId,
  target,
  label,
  icon,
}: {
  propertyId: string;
  target: CycleRow | null | undefined;
  label: string;
  icon: React.ReactNode;
}) {
  if (!target) {
    return (
      <button type="button" className="ibtn" aria-label={label} disabled>
        {icon}
      </button>
    );
  }
  return (
    <Link
      href={`/p/${propertyId}/cycles/${target.id}`}
      className="ibtn"
      aria-label={`${label}: ${cycleLabel(target)}`}
      title={cycleLabel(target)}
    >
      {icon}
    </Link>
  );
}

function StatusGroup({
  status,
  count,
  points,
  children,
}: {
  status: TaskStatus;
  count: number;
  points: number;
  children: React.ReactNode;
}) {
  const label = COLUMNS.find((c) => c.id === status)?.label ?? status;
  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="panel-h">
        <StIcon task={{ status }} />
        <h2>{label}</h2>
        <span className="faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {count}
        </span>
        <div className="acts faint num" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {points} {points === 1 ? "point" : "points"}
        </div>
      </div>
      <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {children}
      </ul>
    </section>
  );
}

function ProgressStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="trunc faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
        {label}
      </dt>
      <dd
        className="row num"
        style={{ margin: "6px 0 0", gap: 6, alignItems: "baseline", fontSize: 19, fontWeight: 600 }}
      >
        {value}
        {sub ? (
          <span className="muted" style={{ fontSize: "var(--g8-fs-xs)", fontWeight: 400 }}>
            {sub}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/** Inline-editable cycle name ("Cycle 12" until someone names it). */
function CycleName({ cycle }: { cycle: CycleRow }) {
  const router = useRouter();
  const [value, setValue] = useState(cycle.name ?? "");
  const [pending, startTransition] = useTransition();
  function commit() {
    const next = value.trim();
    if (next === (cycle.name ?? "")) return;
    startTransition(async () => {
      const res = await renameCycle({ cycleId: cycle.id, name: next || null });
      if ("error" in res) toast.error(res.error);
      else router.refresh();
    });
  }
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(cycle.name ?? "");
          e.currentTarget.blur();
        }
      }}
      placeholder={`Cycle ${cycle.number}`}
      aria-label="Cycle name"
      maxLength={80}
      disabled={pending}
      className="ttl-edit"
      style={{
        width: "100%",
        background: "transparent",
        fontSize: "var(--g8-fs-xl)",
        fontWeight: 600,
        letterSpacing: "-0.015em",
        border: 0,
        outline: "none",
        padding: 0,
      }}
    />
  );
}

function Breakdowns({
  snapshot,
  lookups,
}: {
  snapshot: CycleTask[];
  lookups: ScopeLookups;
}) {
  const [tab, setTab] = useState<BreakdownTab>("assignees");
  const rows: Record<BreakdownTab, { row: BreakdownRow; label: string }[]> = useMemo(() => {
    const label = (r: BreakdownRow, fn: (k: string) => string) => ({
      row: r,
      label: r.key === NONE ? "" : fn(r.key),
    });
    return {
      assignees: breakdown(snapshot, (t) => [t.assignee_id ?? NONE]).map((r) =>
        label(r, (k) => lookups.member(k)?.name ?? "Former member"),
      ),
      labels: breakdown(snapshot, (t) => (t.labels.length ? t.labels : [NONE])).map((r) =>
        label(r, (k) => k),
      ),
      priority: breakdown(snapshot, (t) => [t.priority]).map((r) => ({
        row: r,
        label:
          r.key === "none"
            ? "No priority"
            : (PRIORITY_META[r.key as keyof typeof PRIORITY_META]?.label ?? r.key),
      })),
      projects: breakdown(snapshot, (t) => [t.project_id ?? NONE]).map((r) =>
        label(r, (k) => lookups.project(k)?.name ?? "Archived project"),
      ),
      teams: breakdown(snapshot, (t) => [t.space_id ?? NONE]).map((r) =>
        label(r, (k) => lookups.space(k)?.name ?? "Archived team"),
      ),
    };
  }, [snapshot, lookups]);

  const emptyLabel: Record<BreakdownTab, string> = {
    assignees: "Unassigned",
    labels: "No label",
    priority: "No priority",
    projects: "No project",
    teams: "No team",
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div className="tabs" role="tablist" aria-label="Breakdown" style={{ marginBottom: 6 }}>
        {(
          [
            ["assignees", "Assignees"],
            ["labels", "Labels"],
            ["priority", "Priority"],
            ["projects", "Projects"],
            ["teams", "Teams"],
          ] as const
        ).map(([k, n]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "tab on" : "tab"}
            onClick={() => setTab(k)}
          >
            {n}
          </button>
        ))}
      </div>
      {rows[tab].length === 0 ? (
        <p className="faint" style={{ margin: 0, padding: "12px 0", fontSize: "var(--g8-fs-sm)" }}>
          No tasks yet.
        </p>
      ) : (
        <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {rows[tab].map(({ row, label }) => (
            <li key={row.key} className="row" style={{ height: 30, gap: 8 }}>
              <span className="trunc muted" style={{ flex: 1 }}>
                {label || emptyLabel[tab]}
              </span>
              <span style={{ width: 56, flexShrink: 0 }} className="row">
                <span className="prog green">
                  <i style={{ "--g8-p": row.pct / 100 } as React.CSSProperties} />
                </span>
              </span>
              <span className="faint num" style={{ flexShrink: 0, fontSize: "var(--g8-fs-xs)" }}>
                {row.pct}% of {row.scope}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
