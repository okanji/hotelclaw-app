"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  PanelRightOpen,
  Sparkles,
  TrendingUp,
  UserMinus,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CountBadge } from "@/components/ui/count-badge";
import { TabNav, TabNavItem } from "@/components/ui/tab-nav";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { type Task } from "./kanban";

type Props = {
  propertyId: string;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  hideDone: boolean;
};

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MS_PER_HOUR = 3_600_000;
const ROW_HEIGHT = 60;
const DAY_WIDTH = 84;
const LABEL_WIDTH = 264;

type DayRange = 7 | 14 | 28;
const DAY_RANGES: { id: DayRange; label: string }[] = [
  { id: 7, label: "7 days" },
  { id: 14, label: "14 days" },
  { id: 28, label: "28 days" },
];

type Capacity = 4 | 6 | 8 | 10 | 12;
const CAPACITIES: { id: Capacity; label: string }[] = [
  { id: 4, label: "4h / day" },
  { id: 6, label: "6h / day" },
  { id: 8, label: "8h / day" },
  { id: 10, label: "10h / day" },
  { id: 12, label: "12h / day" },
];

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function startOfWeek(d: Date) {
  const out = startOfDay(d);
  const day = out.getDay();
  // ISO week: Monday = 1. JS getDay: Sun = 0.
  const shift = (day + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

function isWeekend(d: Date) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHours(h: number) {
  if (h <= 0) return "0h";
  if (h < 0.1) return "<0.1h";
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1)}h`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Hours allocation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Hours of a scheduled task that fall inside a specific calendar day. If the
 * task spans multiple days, each day gets only its overlapping slice — so a
 * task running Wed 4pm → Fri 11am contributes 8h, 24h, 11h respectively.
 *
 * Tasks without `scheduled_start`/`scheduled_end` contribute 0 — they're
 * surfaced in the side panel as work-to-schedule rather than load.
 */
function hoursForDay(task: Task, day: Date): number {
  if (!task.scheduled_start || !task.scheduled_end) return 0;
  const start = new Date(task.scheduled_start);
  const end = new Date(task.scheduled_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const ds = startOfDay(day).getTime();
  const de = endOfDay(day).getTime();
  if (end.getTime() < ds || start.getTime() > de) return 0;
  const a = Math.max(start.getTime(), ds);
  const b = Math.min(end.getTime(), de);
  return Math.max(0, (b - a) / MS_PER_HOUR);
}

/** Pure visual bucket for a cell, based on % of daily capacity. */
type Heat = "empty" | "low" | "ok" | "high" | "over";

function bucketFor(hours: number, capacity: number): Heat {
  if (hours <= 0.05) return "empty";
  const r = hours / capacity;
  if (r < 0.45) return "low";
  if (r < 0.9) return "ok";
  if (r <= 1.1) return "high";
  return "over";
}

const EMPTY_MEMBERS: never[] = [];

/**
 * Heat palette — matches the task-card tonal vocabulary: a card-like
 * surface tinted by saturation level, with a single hairline border at ~25%
 * opacity, a soft micro-shadow, and a darker hover state. Empty cells stay
 * close to `bg-card` so they read as quiet placeholders, not gridlines.
 */
const HEAT_CLASS: Record<Heat, { bg: string; border: string; text: string; hover: string }> = {
  empty: {
    bg: "bg-card/60 dark:bg-card/40",
    border: "border-border/50",
    text: "text-muted-foreground/55",
    hover: "hover:border-border",
  },
  low: {
    bg: "bg-emerald-100/70 dark:bg-emerald-500/12",
    border: "border-emerald-400/30 dark:border-emerald-500/25",
    text: "text-emerald-800 dark:text-emerald-200",
    hover: "hover:border-emerald-500/50",
  },
  ok: {
    bg: "bg-emerald-200/75 dark:bg-emerald-500/22",
    border: "border-emerald-500/35 dark:border-emerald-500/35",
    text: "text-emerald-900 dark:text-emerald-100",
    hover: "hover:border-emerald-500/60",
  },
  high: {
    bg: "bg-amber-200/75 dark:bg-amber-500/22",
    border: "border-amber-500/35 dark:border-amber-500/35",
    text: "text-amber-900 dark:text-amber-100",
    hover: "hover:border-amber-500/60",
  },
  over: {
    bg: "bg-red-200/80 dark:bg-red-500/25",
    border: "border-red-500/40 dark:border-red-500/40",
    text: "text-red-900 dark:text-red-100",
    hover: "hover:border-red-500/70",
  },
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

type SortBy = "name" | "load_desc" | "load_asc";

export function WorkloadView({ propertyId, tasks, assignees, hideDone }: Props) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [range, setRange] = useState<DayRange>(14);
  const [capacity, setCapacity] = useState<Capacity>(8);
  const [showPanel, setShowPanel] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("load_desc");

  const windowStart = anchor;
  const windowEnd = addDays(windowStart, range - 1);
  const today = startOfDay(new Date());

  const days = useMemo(
    () => Array.from({ length: range }, (_, i) => addDays(windowStart, i)),
    [windowStart, range],
  );

  // We want every member visible — even those with no tasks — so people with
  // free capacity show up green and idle, not invisible.
  const { data: members } = useQuery(propertyMembersQueryOptions(propertyId));
  const allMembers = useMemo(() => members ?? EMPTY_MEMBERS, [members]);

  // Done tasks already get filtered upstream when hideDone is set; on the
  // workload view we always exclude `done` from load math even when Backlog
  // is off, since completed work isn't future capacity. We still surface
  // "Done" elsewhere via the regular board.
  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);
  void hideDone; // hideDone is honored by upstream filter; we keep this view consistent regardless

  /* ---------- Build per-member, per-day hour matrix --------------------- */

  const matrix = useMemo(() => {
    type Row = {
      assigneeId: string;
      perDay: number[];
      total: number;
    };
    const rows = new Map<string, Row>();
    const dayTotals = new Array(range).fill(0) as number[];
    let unassignedTotal = 0;

    // Seed every member so they appear even with zero load.
    for (const m of allMembers) {
      rows.set(m.id, {
        assigneeId: m.id,
        perDay: new Array(range).fill(0) as number[],
        total: 0,
      });
    }

    for (const t of activeTasks) {
      if (!t.scheduled_start || !t.scheduled_end) continue;
      const targetRow = t.assignee_id ? rows.get(t.assignee_id) : null;
      for (let i = 0; i < range; i++) {
        const h = hoursForDay(t, days[i]!);
        if (h <= 0) continue;
        if (targetRow) {
          targetRow.perDay[i] = (targetRow.perDay[i] ?? 0) + h;
          targetRow.total += h;
        } else if (!t.assignee_id) {
          unassignedTotal += h;
        } else {
          // Assignee not in member list (left org?) — drop into a synthetic row.
          let row = rows.get(t.assignee_id);
          if (!row) {
            row = {
              assigneeId: t.assignee_id,
              perDay: new Array(range).fill(0) as number[],
              total: 0,
            };
            rows.set(t.assignee_id, row);
          }
          row.perDay[i] = (row.perDay[i] ?? 0) + h;
          row.total += h;
        }
        dayTotals[i] = (dayTotals[i] ?? 0) + h;
      }
    }

    return {
      rows: [...rows.values()],
      dayTotals,
      unassignedTotal,
    };
  }, [activeTasks, allMembers, days, range]);

  /* ---------- Sort rows -------------------------------------------------- */

  const sortedRows = useMemo(() => {
    const rows = [...matrix.rows];
    const nameOf = (id: string) =>
      allMembers.find((m) => m.id === id)?.name ??
      assignees[id]?.name ??
      id;
    rows.sort((a, b) => {
      if (sortBy === "name") return nameOf(a.assigneeId).localeCompare(nameOf(b.assigneeId));
      const diff = b.total - a.total;
      if (diff !== 0) return sortBy === "load_desc" ? diff : -diff;
      return nameOf(a.assigneeId).localeCompare(nameOf(b.assigneeId));
    });
    return rows;
  }, [matrix.rows, sortBy, allMembers, assignees]);

  /* ---------- Side-panel buckets ---------------------------------------- */

  const unscheduledTasks = useMemo(
    () => activeTasks.filter((t) => !t.scheduled_start || !t.scheduled_end),
    [activeTasks],
  );
  const unassignedTasks = useMemo(
    () => activeTasks.filter((t) => !t.assignee_id),
    [activeTasks],
  );
  const overdueTasks = useMemo(() => {
    const now = today.getTime();
    return activeTasks.filter((t) => {
      if (!t.due_at) return false;
      return new Date(t.due_at).getTime() < now;
    });
  }, [activeTasks, today]);

  const totalInboxCount =
    unscheduledTasks.length + unassignedTasks.length + overdueTasks.length;

  /* ---------- KPIs ------------------------------------------------------- */

  // Working days in the window are all days; weekends count toward capacity
  // because hotels run 7/7. We can flip this later if the user wants it.
  const totalCapacity = range * capacity * (allMembers.length || 1);
  const totalScheduled = matrix.dayTotals.reduce((a, b) => a + b, 0);
  const utilizationPct = totalCapacity > 0 ? Math.round((totalScheduled / totalCapacity) * 100) : 0;
  const overloadedCount = sortedRows.filter((r) => r.total > range * capacity).length;
  const idleCount = sortedRows.filter((r) => r.total < range * capacity * 0.4).length;

  /* ---------- Nav -------------------------------------------------------- */

  function goPrev() {
    setAnchor((d) => addDays(d, -Math.max(7, range / 2)));
  }
  function goNext() {
    setAnchor((d) => addDays(d, Math.max(7, range / 2)));
  }
  function goToday() {
    setAnchor(startOfWeek(new Date()));
  }

  /* ---------- Header label ----------------------------------------------- */

  const headerLabel = `${windowStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${windowEnd.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  /* ---------- Render ----------------------------------------------------- */

  return (
    <TooltipProvider delay={120}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Main column ------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sub-toolbar */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-2">
            <div className="flex items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={goPrev}
                aria-label="Previous range"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs font-medium tracking-tight"
                onClick={goToday}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={goNext}
                aria-label="Next range"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>

            <span className="ml-1 text-sm font-medium tracking-tight text-foreground">
              {headerLabel}
            </span>

            <div className="ml-auto flex items-center gap-1.5">
              <SelectChip
                value={String(range)}
                label={DAY_RANGES.find((r) => r.id === range)!.label}
                options={DAY_RANGES.map((r) => ({
                  id: String(r.id),
                  label: r.label,
                }))}
                onChange={(id) => setRange(Number(id) as DayRange)}
              />
              <SelectChip
                value={String(capacity)}
                label={CAPACITIES.find((c) => c.id === capacity)!.label}
                options={CAPACITIES.map((c) => ({
                  id: String(c.id),
                  label: c.label,
                }))}
                onChange={(id) => setCapacity(Number(id) as Capacity)}
              />
              <SelectChip
                value={sortBy}
                label={
                  sortBy === "name"
                    ? "Sort: name"
                    : sortBy === "load_asc"
                      ? "Sort: lightest"
                      : "Sort: busiest"
                }
                options={[
                  { id: "load_desc", label: "Busiest first" },
                  { id: "load_asc", label: "Lightest first" },
                  { id: "name", label: "Name (A–Z)" },
                ]}
                onChange={(id) => setSortBy(id as SortBy)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs font-medium tracking-tight"
                onClick={() => setShowPanel(true)}
                aria-label="Open inbox"
                title="Open inbox"
              >
                <PanelRightOpen className="size-3.5" />
                Inbox
                {totalInboxCount > 0 ? (
                  <CountBadge>{totalInboxCount}</CountBadge>
                ) : null}
              </Button>
            </div>
          </div>

          {/* KPI ribbon */}
          <div className="grid shrink-0 grid-cols-4 gap-2.5 border-b border-border/70 bg-card/40 px-4 py-3 dark:bg-muted/10">
            <Kpi
              icon={<TrendingUp className="size-3.5" />}
              label="Team utilization"
              value={`${utilizationPct}%`}
              hint={`${formatHours(totalScheduled)} of ${formatHours(totalCapacity)}`}
              accent="default"
              chart={
                <UtilizationChart
                  days={days}
                  dayTotals={matrix.dayTotals}
                  capacityPerDay={capacity * (allMembers.length || 1)}
                />
              }
            />
            <Kpi
              icon={<AlertTriangle className="size-3.5" />}
              label="Overloaded"
              value={overloadedCount.toString()}
              hint={
                overloadedCount === 1
                  ? "1 person exceeds capacity"
                  : `${overloadedCount} people exceed capacity`
              }
              accent={overloadedCount > 0 ? "danger" : "default"}
            />
            <Kpi
              icon={<Sparkles className="size-3.5" />}
              label="Has bandwidth"
              value={idleCount.toString()}
              hint={
                idleCount === 1 ? "1 person under 40%" : `${idleCount} people under 40%`
              }
              accent="success"
            />
            <Kpi
              icon={<CircleDashed className="size-3.5" />}
              label="To schedule"
              value={(unscheduledTasks.length + unassignedTasks.length).toString()}
              hint={`${unscheduledTasks.length} unscheduled · ${unassignedTasks.length} unassigned`}
              accent={
                unscheduledTasks.length + unassignedTasks.length > 0
                  ? "warning"
                  : "default"
              }
            />
          </div>

          {/* Heatmap grid — sits in a soft well, mirroring the kanban
              columns. Cells float on top as tinted mini-cards. */}
          <div className="flex min-h-0 flex-1 overflow-auto bg-muted/30 dark:bg-muted/15">
            <div className="flex min-w-full">
              {/* Left labels (sticky) */}
              <div
                className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-card/95 backdrop-blur"
                style={{ width: LABEL_WIDTH }}
              >
                <DayHeaderSpacer />
                {sortedRows.length === 0 ? (
                  <EmptyMembersLabel />
                ) : (
                  sortedRows.map((row) => {
                    const member =
                      allMembers.find((m) => m.id === row.assigneeId) ?? null;
                    const info = assignees[row.assigneeId];
                    const name = member?.name ?? info?.name ?? "Unknown";
                    const avatar = member?.avatarUrl ?? info?.avatar ?? null;
                    return (
                      <MemberLabel
                        key={row.assigneeId}
                        name={name}
                        role={member?.role ?? null}
                        avatarUrl={avatar}
                        totalHours={row.total}
                        capacityHours={range * capacity}
                      />
                    );
                  })
                )}
                {/* Totals row label */}
                <div
                  className="flex items-center gap-2 border-t border-border/70 bg-card/95 px-3 backdrop-blur"
                  style={{ height: ROW_HEIGHT * 0.7 }}
                >
                  <Users className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium tracking-tight text-foreground">
                    Daily team total
                  </span>
                </div>
              </div>

              {/* Right grid */}
              <div
                className="relative shrink-0"
                style={{ width: range * DAY_WIDTH }}
              >
                <DayHeader days={days} today={today} />

                {/* Body */}
                <div className="relative">
                  {/* Weekend wash — slightly stronger than the well so the
                      seven-day rhythm is legible without explicit gridlines. */}
                  {days.map((d, i) =>
                    isWeekend(d) ? (
                      <div
                        key={`we-${i}`}
                        aria-hidden
                        className="pointer-events-none absolute top-0 bg-foreground/[0.025] dark:bg-foreground/[0.03]"
                        style={{
                          left: i * DAY_WIDTH,
                          width: DAY_WIDTH,
                          height: "100%",
                        }}
                      />
                    ) : null,
                  )}
                  {/* Today line */}
                  {days.findIndex((d) => sameDay(d, today)) >= 0 ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-0 z-10 w-px bg-primary/60"
                      style={{
                        left:
                          days.findIndex((d) => sameDay(d, today)) * DAY_WIDTH +
                          DAY_WIDTH / 2,
                        height: "100%",
                      }}
                    />
                  ) : null}

                  {sortedRows.length === 0 ? (
                    <EmptyRowsGrid days={days} />
                  ) : (
                    sortedRows.map((row) => (
                      <div
                        key={row.assigneeId}
                        className="relative flex"
                        style={{ height: ROW_HEIGHT }}
                      >
                        {days.map((d, i) => {
                          const hours = row.perDay[i] ?? 0;
                          const heat = bucketFor(hours, capacity);
                          return (
                            <DayCell
                              key={i}
                              hours={hours}
                              heat={heat}
                              capacity={capacity}
                              date={d}
                            />
                          );
                        })}
                      </div>
                    ))
                  )}

                  {/* Day totals row */}
                  <div
                    className="relative flex border-t border-border/70 bg-card/95 backdrop-blur"
                    style={{ height: ROW_HEIGHT * 0.7 }}
                  >
                    {days.map((d, i) => {
                      const total = matrix.dayTotals[i] ?? 0;
                      const teamCap = capacity * (allMembers.length || 1);
                      const pct = teamCap > 0 ? total / teamCap : 0;
                      return (
                        <div
                          key={i}
                          className="relative flex flex-col items-center justify-center gap-1"
                          style={{ width: DAY_WIDTH }}
                        >
                          <span className="text-xs font-medium tabular-nums tracking-tight text-foreground">
                            {formatHours(total)}
                          </span>
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-muted/60">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                pct > 1.05
                                  ? "bg-red-500/80"
                                  : pct > 0.9
                                    ? "bg-amber-500/80"
                                    : pct > 0.4
                                      ? "bg-emerald-500/80"
                                      : "bg-emerald-400/60",
                              )}
                              style={{
                                width: `${Math.min(100, Math.round(pct * 100))}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Inbox — slide-out sheet, opened from the toolbar's "Inbox" button. */}
        <SidePanel
          open={showPanel}
          onOpenChange={setShowPanel}
          propertyId={propertyId}
          unscheduled={unscheduledTasks}
          unassigned={unassignedTasks}
          overdue={overdueTasks}
          assignees={assignees}
          nowMs={today.getTime()}
        />
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function Kpi({
  icon,
  label,
  value,
  hint,
  accent,
  chart,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  accent: "default" | "danger" | "warning" | "success";
  chart?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-foreground/15">
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md",
          accent === "danger" && "bg-destructive/10 text-destructive",
          accent === "warning" && "bg-warning/10 text-warning",
          accent === "success" && "bg-success/10 text-success",
          accent === "default" && "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium tracking-tight text-muted-foreground uppercase">
          {label}
        </p>
        <p className="text-base leading-tight font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        <p className="truncate text-xs tracking-tight text-muted-foreground">
          {hint}
        </p>
      </div>
      {chart ? <div className="ml-1 shrink-0">{chart}</div> : null}
    </div>
  );
}

function UtilizationChart({
  days,
  dayTotals,
  capacityPerDay,
}: {
  days: Date[];
  dayTotals: number[];
  capacityPerDay: number;
}) {
  const width = 96;
  const height = 36;
  const n = days.length;
  const slot = width / n;
  const bw = Math.max(2, slot - 1.5);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="opacity-90"
    >
      {/* Baseline (100% line) */}
      <line
        x1={0}
        x2={width}
        y1={height - 1}
        y2={height - 1}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {days.map((d, i) => {
        const ratio = capacityPerDay > 0 ? (dayTotals[i] ?? 0) / capacityPerDay : 0;
        const clamped = Math.min(1.2, ratio);
        const h = Math.max(1, clamped * (height - 2));
        const fill =
          ratio > 1.05
            ? "var(--destructive)"
            : ratio > 0.9
              ? "rgb(245 158 11)" // amber-500
              : ratio > 0.4
                ? "rgb(16 185 129)" // emerald-500
                : "rgb(110 231 183)"; // emerald-300
        return (
          <rect
            key={i}
            x={i * slot + (slot - bw) / 2}
            y={height - 1 - h}
            width={bw}
            height={h}
            fill={fill}
            opacity={isWeekend(d) ? 0.55 : 0.95}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function DayHeaderSpacer() {
  return (
    <div className="sticky top-0 z-10 h-12 border-b border-border/70 bg-card/95 backdrop-blur" />
  );
}

function DayHeader({ days, today }: { days: Date[]; today: Date }) {
  // Group consecutive days under their month label.
  const months: { label: string; start: number; span: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const label = d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const last = months[months.length - 1];
    if (last && last.label === label) last.span += 1;
    else months.push({ label, start: i, span: 1 });
  }

  return (
    <div className="sticky top-0 z-10 h-12 border-b border-border/70 bg-card/95 backdrop-blur">
      <div className="relative h-5 border-b border-border/40">
        {months.map((m) => (
          <span
            key={m.start}
            className="absolute top-0 truncate px-2 text-xs font-semibold tracking-wide text-foreground"
            style={{
              left: m.start * DAY_WIDTH,
              width: m.span * DAY_WIDTH,
              lineHeight: "20px",
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative h-7">
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          const weekend = isWeekend(d);
          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 flex h-7 flex-col items-center justify-center gap-0.5 text-[10px]",
                weekend ? "text-muted-foreground/60" : "text-muted-foreground",
                isToday && "text-primary",
              )}
              style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
            >
              <span className="leading-none">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "grid size-5 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MemberLabel({
  name,
  role,
  avatarUrl,
  totalHours,
  capacityHours,
}: {
  name: string;
  role: string | null;
  avatarUrl: string | null;
  totalHours: number;
  capacityHours: number;
}) {
  const pct = capacityHours > 0 ? totalHours / capacityHours : 0;
  const barClass =
    pct > 1.05
      ? "bg-red-500"
      : pct > 0.9
        ? "bg-amber-500"
        : pct > 0.4
          ? "bg-emerald-500"
          : "bg-emerald-400/70";
  const totalClass =
    pct > 1.05
      ? "text-red-600 dark:text-red-400"
      : pct > 0.9
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";
  return (
    <div
      className="flex items-center gap-2.5 px-3"
      style={{ height: ROW_HEIGHT }}
    >
      <Avatar className="size-8 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium tracking-tight text-foreground">
          {name}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width]", barClass)}
              style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 text-xs font-medium tabular-nums tracking-tight",
              totalClass,
            )}
          >
            {formatHours(totalHours)}
            <span className="font-normal text-muted-foreground">
              {" / "}
              {formatHours(capacityHours)}
            </span>
          </span>
        </div>
      </div>
      {role ? (
        <Badge
          variant="outline"
          className="hidden rounded-full text-muted-foreground xl:inline-flex"
        >
          {role}
        </Badge>
      ) : null}
    </div>
  );
}

function DayCell({
  hours,
  heat,
  capacity,
  date,
}: {
  hours: number;
  heat: Heat;
  capacity: number;
  date: Date;
}) {
  const tone = HEAT_CLASS[heat];
  const pct = capacity > 0 ? Math.min(1, hours / capacity) : 0;
  return (
    <div
      className="relative flex items-center justify-center px-1.5 py-1.5"
      style={{ width: DAY_WIDTH, height: ROW_HEIGHT }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(
                // Mirror task-card surface: rounded-md, hairline border,
                // tiny shadow, gentle hover. Tinted body conveys load.
                "relative flex h-full w-full cursor-default items-center justify-center rounded-md border bg-card shadow-xs transition-colors",
                tone.bg,
                tone.border,
                tone.hover,
              )}
            />
          }
        >
          <span
            className={cn(
              "relative z-[1] text-sm font-medium tabular-nums tracking-tight",
              tone.text,
            )}
          >
            {heat === "empty" ? "" : formatHours(hours)}
          </span>
          {/* Saturation underline — kept inside the card surface, like a
              progress meter rather than a separate stroke. */}
          {heat !== "empty" ? (
            <span
              aria-hidden
              className={cn(
                "absolute bottom-[5px] left-1/2 h-[2px] -translate-x-1/2 rounded-full",
                heat === "over"
                  ? "bg-red-500/80"
                  : heat === "high"
                    ? "bg-amber-500/80"
                    : heat === "ok"
                      ? "bg-emerald-500/80"
                      : "bg-emerald-400/70",
              )}
              style={{ width: `${Math.round(pct * 60) + 18}%` }}
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>
          {date.toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
          {" · "}
          {formatHours(hours)} scheduled
          {capacity > 0
            ? ` (${Math.round((hours / capacity) * 100)}% of ${formatHours(capacity)})`
            : ""}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function EmptyMembersLabel() {
  return (
    <div
      className="flex items-center gap-2 px-3 text-xs tracking-tight text-muted-foreground"
      style={{ height: ROW_HEIGHT }}
    >
      <UserMinus className="size-3.5" />
      No members yet
    </div>
  );
}

function EmptyRowsGrid({ days }: { days: Date[] }) {
  return (
    <div
      className="relative flex border-b border-border/40"
      style={{ height: ROW_HEIGHT }}
    >
      {days.map((_, i) => (
        <div
          key={i}
          className="border-r border-border/20 last:border-r-0"
          style={{ width: DAY_WIDTH }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Side panel                                                                  */
/* -------------------------------------------------------------------------- */

type PanelTab = "unscheduled" | "unassigned" | "overdue";

function SidePanel({
  open,
  onOpenChange,
  propertyId,
  unscheduled,
  unassigned,
  overdue,
  assignees,
  nowMs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  unscheduled: Task[];
  unassigned: Task[];
  overdue: Task[];
  assignees: Record<string, AssigneeInfo>;
  nowMs: number;
}) {
  const [tab, setTab] = useState<PanelTab>("unscheduled");
  const openTask = useOpenTask(propertyId);

  const list =
    tab === "unscheduled" ? unscheduled : tab === "unassigned" ? unassigned : overdue;
  const totalCount = unscheduled.length + unassigned.length + overdue.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[360px] flex-col gap-0 bg-card p-0 sm:max-w-[360px]"
      >
        <SheetHeader className="shrink-0 border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-sm font-medium tracking-tight">
              Inbox
            </SheetTitle>
            {totalCount > 0 ? <CountBadge>{totalCount}</CountBadge> : null}
          </div>
          <SheetDescription className="sr-only">
            Tasks that need scheduling, assigning, or follow-up.
          </SheetDescription>
        </SheetHeader>
      <TabNav
        variant="pill"
        aria-label="Inbox sections"
        className="shrink-0 border-b border-border/70 px-2 py-1.5"
      >
        <PanelTabButton
          active={tab === "unscheduled"}
          onClick={() => setTab("unscheduled")}
          icon={<CalendarClock className="size-3.5" />}
          label="Unscheduled"
          count={unscheduled.length}
        />
        <PanelTabButton
          active={tab === "unassigned"}
          onClick={() => setTab("unassigned")}
          icon={<UserMinus className="size-3.5" />}
          label="Unassigned"
          count={unassigned.length}
        />
        <PanelTabButton
          active={tab === "overdue"}
          onClick={() => setTab("overdue")}
          icon={<AlertTriangle className="size-3.5" />}
          label="Overdue"
          count={overdue.length}
        />
      </TabNav>

      <div className="flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs tracking-tight text-muted-foreground">
            {tab === "unscheduled" && "Every task has a scheduled window."}
            {tab === "unassigned" && "Every task has an owner."}
            {tab === "overdue" && "Nothing past due — keep it up."}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((t) => {
              const overdue = t.due_at
                ? new Date(t.due_at).getTime() < nowMs
                : false;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openTask(t.id)}
                    className={cn(
                      "group relative flex w-full flex-col items-start gap-2 rounded-md border border-border/70 bg-card p-3 text-left shadow-xs transition-colors",
                      "hover:border-foreground/15",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <div className="flex w-full items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 size-2 shrink-0 rounded-full ring-2 ring-card",
                          t.priority === "urgent" && "bg-red-500",
                          t.priority === "high" && "bg-amber-500",
                          t.priority === "medium" && "bg-blue-500",
                          t.priority === "low" && "bg-zinc-400",
                          t.priority === "none" && "bg-muted-foreground/40",
                        )}
                      />
                      <span className="line-clamp-2 flex-1 text-sm leading-4.5 font-medium tracking-tight text-foreground">
                        {t.title}
                      </span>
                    </div>
                    <div className="flex w-full items-center gap-2 pl-3.5 text-xs tracking-tight text-muted-foreground">
                      {t.assignee_id ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Avatar className="size-4">
                            {assignees[t.assignee_id]?.avatar ? (
                              <AvatarImage
                                src={assignees[t.assignee_id]!.avatar}
                                alt={assignees[t.assignee_id]?.name ?? ""}
                              />
                            ) : null}
                            <AvatarFallback className="bg-muted text-[0.5rem] font-medium text-foreground">
                              {initials(assignees[t.assignee_id]?.name ?? "??")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">
                            {assignees[t.assignee_id]?.name ?? "Unknown"}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <UserMinus className="size-3" />
                          Unassigned
                        </span>
                      )}
                      {t.due_at ? (
                        <span
                          className={cn(
                            "ml-auto inline-flex shrink-0 items-center gap-1",
                            overdue && "text-red-600 dark:text-red-400",
                          )}
                        >
                          <CalendarClock className="size-3" />
                          {new Date(t.due_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </SheetContent>
    </Sheet>
  );
}

function PanelTabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <TabNavItem
      active={active}
      onClick={onClick}
      className="h-7 flex-1 justify-center rounded-md tracking-tight"
    >
      {icon}
      <span>{label}</span>
      <CountBadge
        className={cn(active && "bg-foreground/10 text-foreground")}
      >
        {count}
      </CountBadge>
    </TabNavItem>
  );
}

/* -------------------------------------------------------------------------- */
/* Small select chip used in the sub-toolbar                                   */
/* -------------------------------------------------------------------------- */

function SelectChip({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-card px-2 text-xs font-medium tracking-tight text-foreground shadow-xs transition-colors",
              "hover:border-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "aria-expanded:border-foreground/15 data-popup-open:border-foreground/15",
            )}
          >
            {label}
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-44 p-1">
        <ul className="flex flex-col">
          {options.map((opt) => {
            const selected = opt.id === value;
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  onClick={() => onChange(opt.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm tracking-tight",
                    selected
                      ? "bg-foreground/[0.06] text-foreground"
                      : "text-foreground/90 hover:bg-foreground/[0.05]",
                  )}
                >
                  <span className="flex-1">{opt.label}</span>
                  {selected ? (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
