"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, IterationCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { COLUMNS, PRIORITY_META } from "@/components/tasks/kanban";
import { StatusIcon } from "@/components/tasks/task-icons";
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
          <div className="flex items-center gap-1">
            <NavButton
              propertyId={propertyId}
              target={prev}
              label="Previous cycle"
              icon={<ChevronLeft />}
            />
            <NavButton
              propertyId={propertyId}
              target={next}
              label="Next cycle"
              icon={<ChevronRight />}
            />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <main className="min-w-0 flex-1 px-(--page-gutter) pt-4 pb-16 lg:overflow-y-auto">
          {inCycle.length === 0 && movedOut.length === 0 ? (
            <EmptyState icon={IterationCcw} title="Nothing planned yet" className="mt-8">
              Add tasks to this cycle from a task&apos;s Cycle property, or
              filter the board by cycle to see what&apos;s in it.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
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
                <section>
                  <Eyebrow className="px-2 pb-2">
                    Moved on · {movedOut.length}
                  </Eyebrow>
                  <ul role="list" className="flex flex-col gap-px">
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
        </main>

        <aside className="shrink-0 border-t border-border px-4 py-5 lg:w-[340px] lg:overflow-y-auto lg:border-t-0 lg:shadow-(--sidebar-edge-shadow)">
          <CycleName cycle={cycle} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground tabular-nums">
            {formatRange(cycle.starts_on, cycle.ends_on, refYear)}
            <StatusBadge
              tone={phase === "current" ? "info" : phase === "past" ? "success" : "neutral"}
            >
              {phase === "current"
                ? `${diffDays(today, cycle.ends_on)}d left`
                : phase === "past"
                  ? "Completed"
                  : `Starts in ${diffDays(today, cycle.starts_on)}d`}
            </StatusBadge>
          </div>

          <Eyebrow className="mt-6 mb-3">Progress</Eyebrow>
          <dl className="grid grid-cols-3 gap-3">
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
      <Button variant="ghost" size="icon-sm" aria-label={label} disabled>
        {icon}
      </Button>
    );
  }
  return (
    <Button nativeButton={false}
      variant="ghost"
      size="icon-sm"
      aria-label={`${label}: ${cycleLabel(target)}`}
      title={cycleLabel(target)}
      render={<Link href={`/p/${propertyId}/cycles/${target.id}`} />}
    >
      {icon}
    </Button>
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
    <section>
      <div className="flex items-center gap-2 px-2 pb-1.5 text-sm">
        <StatusIcon status={status} className="size-3.5" />
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-faint-foreground tabular-nums">{count}</span>
        <span className="ml-auto text-xs text-faint-foreground tabular-nums">
          {points} {points === 1 ? "point" : "points"}
        </span>
      </div>
      <ul role="list" className="flex flex-col gap-px">
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
      <dt className="truncate text-xs leading-3 font-medium text-faint-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5 text-lg font-semibold text-foreground tabular-nums">
        {value}
        {sub ? (
          <span className="text-xs font-normal text-muted-foreground">{sub}</span>
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
      className="w-full rounded-md bg-transparent text-2xl leading-[1.3] font-semibold text-foreground placeholder:text-foreground focus-visible:outline-none"
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
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as BreakdownTab)}
      className="mt-6"
    >
      <TabsList className="flex-wrap">
        <TabsTrigger value="assignees">Assignees</TabsTrigger>
        <TabsTrigger value="labels">Labels</TabsTrigger>
        <TabsTrigger value="priority">Priority</TabsTrigger>
        <TabsTrigger value="projects">Projects</TabsTrigger>
        <TabsTrigger value="teams">Teams</TabsTrigger>
      </TabsList>
      {(Object.keys(rows) as BreakdownTab[]).map((key) => (
        <TabsContent key={key} value={key}>
          {rows[key].length === 0 ? (
            <p className="px-2 py-3 text-sm text-faint-foreground">No tasks yet.</p>
          ) : (
            <ul role="list" className="flex flex-col gap-px">
              {rows[key].map(({ row, label }) => (
                <li
                  key={row.key}
                  className="flex h-[30px] items-center gap-2 px-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-secondary-ink">
                    {label || emptyLabel[key]}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {row.pct}% of {row.scope}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
