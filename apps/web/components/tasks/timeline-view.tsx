"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { COLUMNS, PRIORITY_META, STATUS_IDS, type Task } from "./kanban";
import { StatusIcon } from "./task-icons";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { TaskStatus } from "@/lib/db/types";

type Props = {
  propertyId: string;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  hideDone: boolean;
};

const DAY_WIDTH = 44; // px per day
const ROW_HEIGHT = 34; // px per task lane — the house data-row rhythm
const BAR_HEIGHT = 20; // px — leaves a 7px gutter above/below in a 34px lane
const LABEL_WIDTH = 256; // px for the left label pane
const VISIBLE_DAYS = 28; // four-week window
const HINT_HEIGHT = 30; // px chrome row for the "No date" / "Off window" rows
/**
 * Status band height. 32px is `h-8` — the exact height list-view uses for its
 * status group header, so the three task views share one band.
 */
const GROUP_HEIGHT = 32;
const AXIS_MONTH_HEIGHT = 20; // month strip
const AXIS_DAY_HEIGHT = 30; // day-tick strip — chrome row
const AXIS_HEIGHT = AXIS_MONTH_HEIGHT + AXIS_DAY_HEIGHT;
const MS_PER_DAY = 86_400_000;

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Monday of the week containing `d`. */
function startOfWeek(d: Date) {
  const out = startOfDay(d);
  const day = out.getDay();
  // ISO week: Monday = 1. JS getDay: Sun=0,Mon=1,...,Sat=6.
  const shift = (day + 6) % 7;
  out.setDate(out.getDate() - shift);
  return out;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function diffDays(a: Date, b: Date) {
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY,
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Schedulable =
  | { task: Task; kind: "bar"; startDay: number; endDay: number }
  | { task: Task; kind: "milestone"; day: number };

/**
 * A dated task that sits outside the visible window. Carries the date so the
 * section can offer a jump to it — without this the task would be invisible
 * AND uncounted, which reads as "this task doesn't exist".
 */
type OffWindow = { task: Task; dir: "before" | "after"; date: Date };

type Placement = Schedulable | OffWindow | null;

const isOffWindow = (p: Placement): p is OffWindow =>
  p !== null && "dir" in p;

/**
 * Decide how a single task renders on the timeline given the visible window.
 * Returns null only for tasks with nothing plottable.
 *
 * Comparisons are in whole-day offsets, not raw timestamps: the window bounds
 * are midnights, so comparing a `due_at` of 14:00 on the final day against
 * `windowEnd` would drop it a day early.
 */
function place(task: Task, windowStart: Date): Placement {
  const lastDay = VISIBLE_DAYS - 1;

  if (task.scheduled_start && task.scheduled_end) {
    const startDate = new Date(task.scheduled_start);
    const start = diffDays(startDate, windowStart);
    const end = diffDays(new Date(task.scheduled_end), windowStart);
    if (end < 0) return { task, dir: "before", date: startDate };
    if (start > lastDay) return { task, dir: "after", date: startDate };
    return {
      task,
      kind: "bar",
      startDay: Math.max(start, 0),
      endDay: Math.min(end, lastDay),
    };
  }

  if (task.due_at) {
    const dueDate = new Date(task.due_at);
    const day = diffDays(dueDate, windowStart);
    if (day < 0) return { task, dir: "before", date: dueDate };
    if (day > lastDay) return { task, dir: "after", date: dueDate };
    return { task, kind: "milestone", day };
  }

  return null;
}

export function TimelineView({
  propertyId,
  tasks,
  assignees,
  hideDone,
}: Props) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const windowStart = anchor;
  const windowEnd = addDays(windowStart, VISIBLE_DAYS - 1);
  const today = startOfDay(new Date());
  const todayOffset = diffDays(today, windowStart);

  const days = useMemo(
    () => Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart],
  );

  const placedByStatus = useMemo(() => {
    const byStatus = <T,>(): Record<TaskStatus, T[]> => ({
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    });
    const out = byStatus<{ row: Schedulable }>();
    const unscheduled = byStatus<Task>();
    const before = byStatus<OffWindow>();
    const after = byStatus<OffWindow>();

    for (const t of tasks) {
      const p = place(t, windowStart);
      if (p === null) unscheduled[t.status].push(t);
      else if (isOffWindow(p)) {
        (p.dir === "before" ? before : after)[t.status].push(p);
      } else out[t.status].push({ row: p });
    }

    // Nearest off-window task in each direction, so the jump lands on the
    // closest week that actually has something rather than a blank one.
    const nearest = (rows: OffWindow[], dir: "before" | "after") =>
      rows.length === 0
        ? null
        : rows.reduce((best, r) =>
            dir === "before"
              ? r.date > best.date
                ? r
                : best
              : r.date < best.date
                ? r
                : best,
          ).date;

    return { out, unscheduled, before, after, nearest };
  }, [tasks, windowStart]);

  const visibleStatuses = STATUS_IDS.filter(
    (s) => !(hideDone && s === "done"),
  );

  // Total task rows actually rendered, used to size the timeline background.
  const totalRows = visibleStatuses.reduce(
    (acc, s) => acc + Math.max(placedByStatus.out[s].length, 0),
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Nav row — 36px, matching the board toolbar directly above it. */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setAnchor((d) => addDays(d, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setAnchor((d) => addDays(d, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setAnchor(startOfWeek(new Date()))}
          >
            Today
          </Button>
        </div>
        <h2 className="truncate text-sm font-medium text-foreground">
          {windowStart.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          –{" "}
          {windowEnd.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </h2>
        <div className="hidden items-center gap-3 text-xs text-faint-foreground lg:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="block h-1.5 w-4 rounded-full bg-info" />
            Scheduled range
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Diamond className="size-3 fill-warning text-warning" />
            Due date
          </span>
        </div>
      </div>

      {/* Body — left labels + right scrollable timeline */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        {/* Left label column */}
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-card"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Header spacer to match the date axis */}
          <div
            className="sticky top-0 z-10 border-b border-border bg-card"
            style={{ height: AXIS_HEIGHT }}
          />

          {visibleStatuses.map((status) => {
            const col = COLUMNS.find((c) => c.id === status)!;
            const rows = placedByStatus.out[status];
            const offRows = placedByStatus.unscheduled[status];
            const before = placedByStatus.before[status];
            const after = placedByStatus.after[status];
            const offWindow = before.length + after.length;
            return (
              <div key={status}>
                {/* One group-header voice across list / kanban / timeline:
                    StatusIcon + 14px/500 foreground label + faint count on a
                    muted band. Height comes from GROUP_HEIGHT (not padding)
                    so the border-box matches the right pane's spacer exactly
                    — padding here drifted the panes 1px per status section. */}
                <header
                  className="flex items-center gap-2 border-b border-border bg-muted px-3"
                  style={{ height: GROUP_HEIGHT }}
                >
                  <StatusIcon status={col.id} className="size-3.5" />
                  <h3 className="truncate text-sm font-medium text-foreground">
                    {col.label}
                  </h3>
                  <span className="ml-auto text-xs tabular-nums text-faint-foreground">
                    {rows.length + offRows.length + offWindow}
                  </span>
                </header>
                {rows.length === 0 && offRows.length === 0 && offWindow === 0 ? (
                  <div
                    className="flex items-center border-b border-border px-3 text-xs text-faint-foreground"
                    style={{ height: ROW_HEIGHT }}
                  >
                    Nothing scheduled
                  </div>
                ) : (
                  rows.map(({ row }) => (
                    <RowLabel
                      key={row.task.id}
                      task={row.task}
                      assignee={
                        row.task.assignee_id
                          ? assignees[row.task.assignee_id]
                          : undefined
                      }
                      propertyId={propertyId}
                    />
                  ))
                )}
                {offRows.length > 0 ? (
                  <div
                    className="flex items-center border-b border-border px-3"
                    style={{ height: HINT_HEIGHT }}
                  >
                    <p className="text-xs text-faint-foreground">
                      No date — {offRows.length}
                    </p>
                  </div>
                ) : null}
                {offWindow > 0 ? (
                  <div
                    className="flex items-center border-b border-border px-3"
                    style={{ height: HINT_HEIGHT }}
                  >
                    <p className="text-xs text-faint-foreground">
                      Off window — {offWindow}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Right timeline */}
        <div className="relative shrink-0" style={{ width: VISIBLE_DAYS * DAY_WIDTH }}>
          {/* Date axis */}
          <DayHeader days={days} todayOffset={todayOffset} />

          {/* Body grid + bars */}
          <div className="relative">
            {/* Background day grid — drawn once for the whole body so column
                lines stay continuous across status sections. `--border` is
                already a 7% warm hairline; it is not thinned further. */}
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px " +
                  DAY_WIDTH +
                  "px)",
              }}
            />
            {/* Weekend tint */}
            {days.map((d, i) =>
              d.getDay() === 0 || d.getDay() === 6 ? (
                <div
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute top-0 bg-muted"
                  style={{
                    left: i * DAY_WIDTH,
                    width: DAY_WIDTH,
                    height: "100%",
                  }}
                />
              ) : null,
            )}
            {/* Today line — a 1px hairline, not a bar */}
            {todayOffset >= 0 && todayOffset < VISIBLE_DAYS ? (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 z-10 w-px bg-destructive"
                style={{
                  left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2,
                  height: "100%",
                }}
              />
            ) : null}

            {/* Rows */}
            {visibleStatuses.map((status) => {
              const rows = placedByStatus.out[status];
              const offRows = placedByStatus.unscheduled[status];
              const before = placedByStatus.before[status];
              const after = placedByStatus.after[status];
              const offWindow = before.length + after.length;
              const sectionRows = Math.max(rows.length, 0);
              return (
                <div key={status}>
                  {/* Status band spacer. `bg-card` under an inset `bg-muted`
                      layer reproduces the left pane's band exactly — the
                      muted token is translucent, so painting it straight onto
                      the grid/weekend tint made the two halves of the same
                      band read as different fills. */}
                  <div
                    className="relative border-b border-border bg-card"
                    style={{ height: GROUP_HEIGHT }}
                  >
                    <div aria-hidden className="absolute inset-0 bg-muted" />
                  </div>
                  {sectionRows === 0 && offRows.length === 0 && offWindow === 0 ? (
                    <div
                      className="border-b border-border"
                      style={{ height: ROW_HEIGHT }}
                    />
                  ) : (
                    rows.map(({ row }) => (
                      <TimelineRow
                        key={row.task.id}
                        item={row}
                        propertyId={propertyId}
                      />
                    ))
                  )}
                  {offRows.length > 0 ? (
                    <div
                      className="flex items-center border-b border-border px-3"
                      style={{ height: HINT_HEIGHT }}
                    >
                      <p className="text-xs text-faint-foreground">
                        Add a due date to plot here
                      </p>
                    </div>
                  ) : null}
                  {offWindow > 0 ? (
                    <div
                      className="relative flex items-center gap-1 border-b border-border px-2"
                      style={{ height: HINT_HEIGHT }}
                    >
                      {before.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const d = placedByStatus.nearest(before, "before");
                            if (d) setAnchor(startOfWeek(d));
                          }}
                          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
                        >
                          <ChevronLeft className="size-3.5" />
                          {before.length} earlier
                        </button>
                      ) : null}
                      {after.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const d = placedByStatus.nearest(after, "after");
                            if (d) setAnchor(startOfWeek(d));
                          }}
                          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
                        >
                          {after.length} later
                          <ChevronRight className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {totalRows === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No tasks fall within this window.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayHeader({
  days,
  todayOffset,
}: {
  days: Date[];
  todayOffset: number;
}) {
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
    <div
      className="sticky top-0 z-10 border-b border-border bg-card"
      style={{ height: AXIS_HEIGHT }}
    >
      <div
        className="relative border-b border-border"
        style={{ height: AXIS_MONTH_HEIGHT }}
      >
        {months.map((m) => (
          <span
            key={m.start}
            className="absolute top-0 truncate px-2 text-xs font-medium text-faint-foreground"
            style={{
              left: m.start * DAY_WIDTH,
              width: m.span * DAY_WIDTH,
              lineHeight: `${AXIS_MONTH_HEIGHT}px`,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative" style={{ height: AXIS_DAY_HEIGHT }}>
        {days.map((d, i) => {
          const isToday = i === todayOffset;
          return (
            <div
              key={i}
              className={cn(
                // 12px faint ticks on one line — the today column is marked
                // by ink plus the hairline today-line, not a filled disc.
                "absolute top-0 flex items-center justify-center gap-1 text-xs tabular-nums text-faint-foreground",
                isToday && "font-medium text-destructive",
              )}
              style={{
                left: i * DAY_WIDTH,
                width: DAY_WIDTH,
                height: AXIS_DAY_HEIGHT,
              }}
            >
              <span>
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
              <span>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowLabel({
  task,
  assignee,
  propertyId,
}: {
  task: Task;
  assignee: AssigneeInfo | undefined;
  propertyId: string;
}) {
  const open = useOpenTask(propertyId);
  return (
    <button
      type="button"
      onClick={() => open(task.id)}
      className="flex w-full items-center gap-3 border-b border-border px-3 py-1.5 text-left hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
      style={{ height: ROW_HEIGHT }}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {task.title}
      </span>
      {task.assignee_id ? (
        <Avatar size="sm" className="size-5 shrink-0">
          {assignee?.avatar ? (
            <AvatarImage src={assignee.avatar} alt={assignee.name} />
          ) : null}
          <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
            {initials(assignee?.name ?? "??")}
          </AvatarFallback>
        </Avatar>
      ) : null}
    </button>
  );
}

function TimelineRow({
  item,
  propertyId,
}: {
  item: Schedulable;
  propertyId: string;
}) {
  const open = useOpenTask(propertyId);
  const priority = PRIORITY_META[item.task.priority];
  return (
    <div
      className="relative border-b border-border"
      style={{ height: ROW_HEIGHT }}
    >
      {item.kind === "bar" ? (
        <button
          type="button"
          title={`${item.task.title} — ${priority.label}`}
          onClick={() => open(item.task.id)}
          className={cn(
            // Hover is a fill-strength change only — no ring, no lift, no
            // border change. The blue focus shadow is the focus signal.
            "absolute top-1/2 -translate-y-1/2 truncate rounded-md px-2 text-left text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focus",
            // Semantic ramp — priority is the only signal this view carries
            // for a bar (the lanes are already grouped by status).
            item.task.priority === "urgent" && "bg-destructive",
            item.task.priority === "high" && "bg-warning",
            item.task.priority === "medium" && "bg-info",
            item.task.priority === "low" && "bg-muted-foreground",
            item.task.status === "done" && "opacity-60",
          )}
          style={{
            left: item.startDay * DAY_WIDTH + 2,
            width: Math.max((item.endDay - item.startDay + 1) * DAY_WIDTH - 4, DAY_WIDTH - 4),
            height: BAR_HEIGHT,
            lineHeight: `${BAR_HEIGHT}px`,
          }}
        >
          {item.task.title}
        </button>
      ) : (
        <button
          type="button"
          title={`${item.task.title} — due`}
          onClick={() => open(item.task.id)}
          className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
          style={{ left: item.day * DAY_WIDTH + DAY_WIDTH / 2 }}
          aria-label={`${item.task.title}, due milestone`}
        >
          <Diamond
            className={cn(
              "size-4",
              item.task.priority === "urgent" && "fill-destructive text-destructive",
              item.task.priority === "high" && "fill-warning text-warning",
              item.task.priority === "medium" && "fill-info text-info",
              item.task.priority === "low" && "fill-muted-foreground text-muted-foreground",
              item.task.status === "done" && "opacity-50",
            )}
          />
        </button>
      )}
    </div>
  );
}
