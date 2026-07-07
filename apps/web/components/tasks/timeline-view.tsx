"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { COLUMNS, PRIORITY_META, STATUS_IDS, type Task } from "./kanban";
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
const ROW_HEIGHT = 36; // px per task row
const LABEL_WIDTH = 256; // px for the left label pane
const VISIBLE_DAYS = 28; // four-week window
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

/** Decide how a single task renders on the timeline given the visible window. */
function place(
  task: Task,
  windowStart: Date,
  windowEnd: Date,
): Schedulable | null {
  if (task.scheduled_start && task.scheduled_end) {
    const start = new Date(task.scheduled_start);
    const end = new Date(task.scheduled_end);
    // Skip ranges that fall entirely outside the visible window.
    if (end < windowStart || start > windowEnd) return null;
    const clampedStart = start < windowStart ? windowStart : start;
    const clampedEnd = end > windowEnd ? windowEnd : end;
    return {
      task,
      kind: "bar",
      startDay: diffDays(clampedStart, windowStart),
      endDay: diffDays(clampedEnd, windowStart),
    };
  }
  if (task.due_at) {
    const d = new Date(task.due_at);
    if (d < windowStart || d > windowEnd) return null;
    return { task, kind: "milestone", day: diffDays(d, windowStart) };
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
    const out: Record<TaskStatus, { row: Schedulable; unplaced?: false }[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    const unscheduled: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    for (const t of tasks) {
      const p = place(t, windowStart, windowEnd);
      if (p) out[t.status].push({ row: p });
      else if (!t.scheduled_start && !t.scheduled_end && !t.due_at) {
        unscheduled[t.status].push(t);
      }
    }
    return { out, unscheduled };
  }, [tasks, windowStart, windowEnd]);

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
      {/* Nav row */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
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
        <h2 className="text-sm font-medium text-foreground">
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
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="block h-1.5 w-4 rounded-full bg-blue-500/70" />
            Scheduled range
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Diamond className="size-3 fill-amber-500 text-amber-500" />
            Due date
          </span>
        </div>
      </div>

      {/* Body — left labels + right scrollable timeline */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        {/* Left label column */}
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-background/95 backdrop-blur"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Header spacer to match the day-header row */}
          <div className="sticky top-0 z-10 h-12 border-b border-border bg-background/95" />

          {visibleStatuses.map((status) => {
            const col = COLUMNS.find((c) => c.id === status)!;
            const rows = placedByStatus.out[status];
            const offRows = placedByStatus.unscheduled[status];
            return (
              <div key={status}>
                <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  <span className={cn("size-2 rounded-full", col.dotClass)} />
                  <h3 className="text-xs font-semibold text-foreground">
                    {col.label}
                  </h3>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {rows.length + offRows.length}
                  </span>
                </header>
                {rows.length === 0 && offRows.length === 0 ? (
                  <div
                    className="border-b border-border/40 px-3 text-xs text-muted-foreground/70"
                    style={{ lineHeight: `${ROW_HEIGHT}px`, height: ROW_HEIGHT }}
                  >
                    —
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
                  <div className="border-b border-border/40 px-3 py-1.5">
                    <p className="text-xs tracking-wide text-muted-foreground/70 uppercase">
                      No date — {offRows.length}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Right timeline */}
        <div className="relative shrink-0" style={{ width: VISIBLE_DAYS * DAY_WIDTH }}>
          {/* Day header */}
          <DayHeader days={days} todayOffset={todayOffset} />

          {/* Body grid + bars */}
          <div className="relative">
            {/* Background day grid — drawn once for the whole body so column
                lines stay continuous across status sections */}
            <div
              className="absolute inset-0"
              aria-hidden
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px " +
                  DAY_WIDTH +
                  "px)",
                backgroundSize: `${DAY_WIDTH * 7}px 100%`,
                opacity: 0.3,
              }}
            />
            {/* Weekend tint */}
            {days.map((d, i) =>
              d.getDay() === 0 || d.getDay() === 6 ? (
                <div
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute top-0 bg-muted/40"
                  style={{
                    left: i * DAY_WIDTH,
                    width: DAY_WIDTH,
                    height: "100%",
                  }}
                />
              ) : null,
            )}
            {/* Today line */}
            {todayOffset >= 0 && todayOffset < VISIBLE_DAYS ? (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 z-10 w-px bg-red-500/60"
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
              const sectionRows = Math.max(rows.length, 0);
              return (
                <div key={status}>
                  {/* Status header spacer to match left pane height (28px) */}
                  <div className="h-7 border-b border-border bg-muted/20" />
                  {sectionRows === 0 && offRows.length === 0 ? (
                    <div
                      className="border-b border-border/40"
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
                    <div className="border-b border-border/40 py-1.5">
                      <p className="px-3 text-[10px] text-muted-foreground/70">
                        Add a due date to plot here
                      </p>
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
    <div className="sticky top-0 z-10 h-12 border-b border-border bg-background/95 backdrop-blur">
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
          const isToday = i === todayOffset;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div
              key={i}
              className={cn(
                "absolute top-0 flex h-7 flex-col items-center justify-center text-[10px]",
                isWeekend ? "text-muted-foreground/60" : "text-muted-foreground",
                isToday && "text-red-600 dark:text-red-400",
              )}
              style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
            >
              <span className="leading-none">
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full text-xs font-semibold tabular-nums",
                  isToday && "bg-red-500 text-white",
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
      className="flex w-full items-center gap-2 border-b border-border/40 px-3 text-left hover:bg-muted/40"
      style={{ height: ROW_HEIGHT }}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {task.title}
      </span>
      {task.assignee_id ? (
        <Avatar size="sm" className="size-5 shrink-0">
          {assignee?.avatar ? (
            <AvatarImage src={assignee.avatar} alt={assignee.name} />
          ) : null}
          <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
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
      className="relative border-b border-border/40"
      style={{ height: ROW_HEIGHT }}
    >
      {item.kind === "bar" ? (
        <button
          type="button"
          title={`${item.task.title} — ${priority.label}`}
          onClick={() => open(item.task.id)}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 truncate rounded-md px-2 text-left text-xs font-medium text-white shadow-sm hover:ring-2 hover:ring-white/30",
            // Priority-tinted bar — stripe colors translated to bg.
            item.task.priority === "urgent" && "bg-red-500",
            item.task.priority === "high" && "bg-amber-500",
            item.task.priority === "medium" && "bg-blue-500/85",
            item.task.priority === "low" && "bg-zinc-500/85",
            item.task.status === "done" && "opacity-60",
          )}
          style={{
            left: item.startDay * DAY_WIDTH + 2,
            width: Math.max((item.endDay - item.startDay + 1) * DAY_WIDTH - 4, DAY_WIDTH - 4),
            height: ROW_HEIGHT - 14,
            lineHeight: `${ROW_HEIGHT - 14}px`,
          }}
        >
          {item.task.title}
        </button>
      ) : (
        <button
          type="button"
          title={`${item.task.title} — due`}
          onClick={() => open(item.task.id)}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 hover:scale-110"
          style={{ left: item.day * DAY_WIDTH + DAY_WIDTH / 2 }}
          aria-label={`${item.task.title}, due milestone`}
        >
          <Diamond
            className={cn(
              "size-4",
              item.task.priority === "urgent" && "fill-red-500 text-red-500",
              item.task.priority === "high" && "fill-amber-500 text-amber-500",
              item.task.priority === "medium" && "fill-blue-500 text-blue-500",
              item.task.priority === "low" && "fill-zinc-500 text-zinc-500",
              item.task.status === "done" && "opacity-50",
            )}
          />
        </button>
      )}
    </div>
  );
}
