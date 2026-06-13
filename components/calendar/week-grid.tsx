"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import {
  addMinutes,
  isSameDay,
  layoutColumns,
  MINUTES_PER_DAY,
  minutesFromMidnight,
  snapToGrain,
  startOfDay,
} from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import { EventBlock } from "./event-block";
import type { CalendarEvent, FreeBusySlot } from "@/lib/calendar/types";

const HOUR_HEIGHT_PX = 48;
const SNAP_MINUTES = 15;

type Props = {
  /** 1 element = day view; 7 = week view. */
  days: Date[];
  events: CalendarEvent[];
  propertyId: string;
  overlayUsers: Set<string>;
  /**
   * Free/busy slots for the toggled overlay users. We don't pull these
   * inside this component — the room owns the query so cache keys stay
   * adjacent to the events query.
   */
  freeBusy: FreeBusySlot[];
  /** Stable per-user colour map (id → hex). Built in the room from the
   *  member palette so two grids in the same render don't disagree. */
  userColors: Map<string, string>;
  onCreateSlot: (start: Date, end: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
};

/**
 * Day/Week time grid. Renders a scrollable time-axis (24 hour rows) and a
 * column per visible day. All-day events stack in a separate band above the
 * grid; timed events lay out inside their column using the column-packing
 * algorithm in `layoutColumns`.
 *
 * Interaction:
 *   * Click an empty cell → opens the create dialog with a 60-minute slot.
 *   * Drag inside a column → live slot preview, opens the dialog on release.
 *   * Click an event → opens the edit dialog (passed up to the parent).
 *
 * The drop target is hooked into dnd-kit so the parent's drag-task-onto-
 * calendar feature can land here too.
 */
export function WeekGrid({
  days,
  events,
  overlayUsers,
  freeBusy,
  userColors,
  onCreateSlot,
  onSelectEvent,
}: Props) {
  // Stable lane order keyed on `overlayUsers` membership — the renderer
  // draws each user's free/busy in their own lane down the right edge of
  // each column. Sets aren't ordered, so we sort by id for determinism.
  const lanes = useMemo(
    () => Array.from(overlayUsers).sort(),
    [overlayUsers],
  );
  // Index busy slots by day so each column lookup is O(1).
  const slotsByDay = useMemo(() => {
    const map = new Map<string, FreeBusySlot[]>();
    for (const slot of freeBusy) {
      if (slot.busy === "free") continue;
      const start = new Date(slot.start_at);
      const end = new Date(slot.end_at);
      // A slot can span multiple days — clamp each crossed day.
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      while (cursor < end) {
        const key = cursor.toDateString();
        const arr = map.get(key) ?? [];
        arr.push(slot);
        map.set(key, arr);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [freeBusy]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the grid to 7am on first paint so the "useful" part of the day
  // is in view without manual scrolling.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = 7 * HOUR_HEIGHT_PX;
  }, []);

  // Bucket events into timed vs all-day. All-day events also include
  // anything whose start = day start and end >= next day's start.
  const { allDayByDay, timedByDay } = useMemo(() => {
    const allDay: Record<string, CalendarEvent[]> = {};
    const timed: Record<string, CalendarEvent[]> = {};
    for (const day of days) {
      allDay[day.toDateString()] = [];
      timed[day.toDateString()] = [];
    }
    for (const ev of events) {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      for (const day of days) {
        if (!overlaps(day, start, end)) continue;
        const key = day.toDateString();
        if (ev.all_day || end.getTime() - start.getTime() >= 24 * 60 * 60_000) {
          allDay[key].push(ev);
        } else {
          timed[key].push(ev);
        }
      }
    }
    return { allDayByDay: allDay, timedByDay: timed };
  }, [days, events]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* All-day band */}
      <div className="flex border-b border-border">
        <div className="w-14 shrink-0 border-r border-border" />
        {days.map((d) => (
          <div
            key={d.toDateString()}
            className={cn(
              "flex flex-1 flex-col gap-1 border-r border-border px-1.5 py-1.5",
              isWeekend(d) && "bg-muted/30",
              isSameDay(d, new Date()) && "bg-primary/4",
            )}
          >
            <DayHeader date={d} />
            <div className="flex flex-col gap-1">
              {(allDayByDay[d.toDateString()] ?? []).map((ev) => (
                <button
                  key={`${ev.source}:${ev.id}`}
                  type="button"
                  onClick={() => onSelectEvent(ev)}
                  className={cn(
                    "truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-[11px] font-medium",
                    eventTint(ev),
                  )}
                >
                  {ev.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Timed grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-auto">
        <HourAxis />
        {days.map((day) => (
          <DayColumn
            key={day.toDateString()}
            day={day}
            events={timedByDay[day.toDateString()] ?? []}
            freeBusySlots={slotsByDay.get(day.toDateString()) ?? []}
            lanes={lanes}
            userColors={userColors}
            onCreateSlot={onCreateSlot}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  );
}

function DayHeader({ date }: { date: Date }) {
  const today = isSameDay(date, new Date());
  return (
    <div className="flex items-baseline justify-between">
      <span
        className={cn(
          "text-[10px] font-medium uppercase tracking-wide",
          today ? "text-primary" : "text-muted-foreground",
        )}
      >
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-sm font-medium tabular-nums",
          today
            ? "bg-primary text-primary-foreground"
            : "text-foreground",
        )}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

function HourAxis() {
  return (
    <div className="w-14 shrink-0 border-r border-border">
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="relative" style={{ height: HOUR_HEIGHT_PX }}>
          {/* Label sits centered on the hour rule, Google Calendar style,
              rather than floating below it. */}
          {h > 0 ? (
            <div className="absolute inset-x-0 top-0 -translate-y-1/2 pr-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground/80">
              {formatHourLabel(h)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatHourLabel(h: number): string {
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

function DayColumn({
  day,
  events,
  freeBusySlots,
  lanes,
  userColors,
  onCreateSlot,
  onSelectEvent,
}: {
  day: Date;
  events: CalendarEvent[];
  freeBusySlots: FreeBusySlot[];
  lanes: string[];
  userColors: Map<string, string>;
  onCreateSlot: (start: Date, end: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startMin: number; endMin: number } | null>(
    null,
  );

  // dnd-kit drop target so a TaskCard dragged here can schedule on this day.
  // Drop payload uses the column's bounding rect to compute the dropped
  // y-position into minutes (done in onDragEnd at the parent).
  const droppableId = `calendar-day:${day.toDateString()}`;
  const droppable = useDroppable({
    id: droppableId,
    data: { kind: "calendar-day", date: day.toISOString() },
  });

  // Live drop preview for a task chip dragged over this column — a ghost
  // event block snapped to the 15-minute grid at the chip's top edge, so
  // the user sees exactly where (and when) the task will land before
  // releasing. Uses the same math as the room's onDragEnd so the preview
  // and the actual drop always agree.
  const [taskDrop, setTaskDrop] = useState<{
    startMin: number;
    title: string;
  } | null>(null);
  useDndMonitor({
    onDragMove(e) {
      const data = e.active.data.current as
        | { kind?: string; title?: string }
        | undefined;
      if (data?.kind !== "task") return;
      if (e.over?.id !== droppableId) {
        setTaskDrop(null);
        return;
      }
      const chipTop = e.active.rect.current.translated?.top;
      const colRect = columnRef.current?.getBoundingClientRect();
      if (chipTop == null || !colRect || colRect.height === 0) return;
      const raw =
        ((chipTop - colRect.top) / colRect.height) * MINUTES_PER_DAY;
      const startMin = Math.max(
        0,
        Math.min(MINUTES_PER_DAY - 60, snapToGrain(raw, SNAP_MINUTES)),
      );
      setTaskDrop((prev) =>
        prev?.startMin === startMin
          ? prev
          : { startMin, title: data.title ?? "" },
      );
    },
    onDragEnd() {
      setTaskDrop(null);
    },
    onDragCancel() {
      setTaskDrop(null);
    },
  });

  // layoutColumns reads `start` / `end` off each item — wrap each event so
  // the algorithm sees `Date` objects, then unwrap on the way out so the
  // renderer keeps the full `CalendarEvent` for click handling.
  type Positioned = { event: CalendarEvent; start: Date; end: Date };
  const placements = useMemo(() => {
    const wrapped: Positioned[] = events.map((e) => ({
      event: e,
      start: new Date(e.start),
      end: new Date(e.end),
    }));
    return layoutColumns(wrapped);
  }, [events]);

  // Convert a clientY to a snapped minutes-from-midnight value for this column.
  function clientYToMinutes(y: number): number {
    const rect = columnRef.current!.getBoundingClientRect();
    const within = Math.max(0, Math.min(rect.height, y - rect.top));
    const minutes = (within / HOUR_HEIGHT_PX) * 60;
    return snapToGrain(minutes, SNAP_MINUTES);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Click landed on an event block: ignore — that block has its own
    // onClick handler and we don't want to start a new drag underneath.
    if (target.closest("[data-event-block]")) return;
    const startMin = clientYToMinutes(e.clientY);
    setDrag({ startMin, endMin: startMin + SNAP_MINUTES * 4 });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const m = clientYToMinutes(e.clientY);
    setDrag((d) =>
      d ? { startMin: d.startMin, endMin: Math.max(d.startMin + SNAP_MINUTES, m) } : d,
    );
  }

  function handlePointerUp() {
    if (!drag) return;
    const dayStart = startOfDay(day);
    const start = addMinutes(dayStart, drag.startMin);
    const end = addMinutes(dayStart, drag.endMin);
    setDrag(null);
    onCreateSlot(start, end);
  }

  return (
    <div
      ref={(node) => {
        columnRef.current = node;
        droppable.setNodeRef(node);
      }}
      className={cn(
        "relative flex-1 border-r border-border",
        isWeekend(day) && "bg-muted/30",
        isSameDay(day, new Date()) && "bg-primary/4",
        droppable.isOver && "bg-primary/10",
      )}
      style={{ height: HOUR_HEIGHT_PX * 24 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Hour rule lines, with a fainter dashed rule on the half hour */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h}>
          <div
            className="absolute inset-x-0 border-t border-border/60"
            style={{ top: h * HOUR_HEIGHT_PX }}
          />
          <div
            className="absolute inset-x-0 border-t border-dashed border-border/30"
            style={{ top: h * HOUR_HEIGHT_PX + HOUR_HEIGHT_PX / 2 }}
          />
        </div>
      ))}

      {/* Now-line: only on today's column */}
      {isSameDay(day, new Date()) ? <NowLine /> : null}

      {/* Per-user free/busy lanes — translucent bars along the right edge.
          Each toggled-on user gets one narrow lane (max 4 lanes before we
          stop growing — beyond that we'd want a pop-out summary). */}
      {lanes.length > 0 ? (
        <FreeBusyLanes
          day={day}
          slots={freeBusySlots}
          lanes={lanes}
          userColors={userColors}
        />
      ) : null}

      {/* Event blocks */}
      {placements.map(({ event: wrapped, column, columns }) => {
        const ev = wrapped.event;
        return (
          <PositionedEvent
            key={`${ev.source}:${ev.id}`}
            day={day}
            event={ev}
            column={column}
            columns={columns}
            onSelect={() => onSelectEvent(ev)}
          />
        );
      })}

      {/* Drag-to-create slot preview */}
      {drag ? (
        <div
          className="pointer-events-none absolute inset-x-1 rounded-md border border-primary/60 bg-primary/15"
          style={{
            top: (drag.startMin / 60) * HOUR_HEIGHT_PX,
            height:
              ((drag.endMin - drag.startMin) / 60) * HOUR_HEIGHT_PX,
          }}
        />
      ) : null}

      {/* Task-drop preview — ghost of the 1-hour block the task will
          occupy if released here, snapped to the 15-minute grid. */}
      {taskDrop ? (
        <div
          className="pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-2 border-l-amber-500 bg-amber-500/15 py-1 pr-1.5 pl-2 text-left text-[11px] text-amber-900 shadow-sm ring-1 ring-inset ring-amber-500/30 dark:text-amber-100"
          style={{
            top: (taskDrop.startMin / 60) * HOUR_HEIGHT_PX,
            height: HOUR_HEIGHT_PX,
          }}
        >
          <div className="truncate font-medium">{taskDrop.title}</div>
          <div className="truncate text-[10px] tabular-nums opacity-70">
            {formatMinutesLabel(day, taskDrop.startMin)} –{" "}
            {formatMinutesLabel(day, taskDrop.startMin + 60)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PositionedEvent({
  day,
  event,
  column,
  columns,
  onSelect,
}: {
  day: Date;
  event: CalendarEvent;
  column: number;
  columns: number;
  onSelect: () => void;
}) {
  // Clamp the event's time range to *this* day so a multi-day event
  // renders flush to the top/bottom of each spanned column.
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dayStart = startOfDay(day);
  const dayEnd = addMinutes(dayStart, MINUTES_PER_DAY);
  const visibleStart = start < dayStart ? dayStart : start;
  const visibleEnd = end > dayEnd ? dayEnd : end;
  const top =
    (minutesFromMidnight(visibleStart) / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(
    16,
    ((visibleEnd.getTime() - visibleStart.getTime()) / 60_000 / 60) *
      HOUR_HEIGHT_PX,
  );
  const widthPct = 100 / columns;
  const leftPct = column * widthPct;
  return (
    <button
      type="button"
      data-event-block
      onClick={onSelect}
      className={cn(
        "absolute overflow-hidden rounded-md border-l-2 py-1 pr-1.5 pl-2 text-left text-[11px] shadow-xs ring-1 ring-inset transition-shadow hover:z-10 hover:shadow-md",
        eventTint(event),
      )}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        // An explicit event colour overrides the source tint, including
        // the accent edge — the tint classes only carry the fallback.
        ...(event.color
          ? {
              borderLeftColor: `#${event.color}`,
              backgroundColor: `#${event.color}1A`,
            }
          : undefined),
      }}
    >
      <EventBlock event={event} />
    </button>
  );
}

function FreeBusyLanes({
  day,
  slots,
  lanes,
  userColors,
}: {
  day: Date;
  slots: FreeBusySlot[];
  lanes: string[];
  userColors: Map<string, string>;
}) {
  const dayStart = startOfDay(day);
  const dayEnd = addMinutes(dayStart, MINUTES_PER_DAY);
  const laneWidthPx = 6;
  const laneGapPx = 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 flex"
      style={{ width: lanes.length * (laneWidthPx + laneGapPx) }}
    >
      {lanes.map((userId) => {
        const color = userColors.get(userId) ?? "94a3b8";
        const userSlots = slots.filter((s) => s.user_id === userId);
        return (
          <div
            key={userId}
            className="relative h-full"
            style={{
              width: laneWidthPx,
              marginLeft: laneGapPx,
              backgroundColor: `#${color}10`,
            }}
          >
            {userSlots.map((slot, idx) => {
              const slotStart = new Date(slot.start_at);
              const slotEnd = new Date(slot.end_at);
              const visStart =
                slotStart < dayStart ? dayStart : slotStart;
              const visEnd = slotEnd > dayEnd ? dayEnd : slotEnd;
              const top =
                (minutesFromMidnight(visStart) / 60) * HOUR_HEIGHT_PX;
              const height = Math.max(
                3,
                ((visEnd.getTime() - visStart.getTime()) /
                  60_000 /
                  60) *
                  HOUR_HEIGHT_PX,
              );
              const opacity = slot.busy === "tentative" ? 0.45 : 0.75;
              return (
                <div
                  key={`${slot.start_at}-${idx}`}
                  className="absolute inset-x-0 rounded-sm"
                  style={{
                    top,
                    height,
                    backgroundColor: `#${color}`,
                    opacity,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function NowLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const top = (minutesFromMidnight(now) / 60) * HOUR_HEIGHT_PX;
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-rose-500"
        style={{ top }}
      />
      <div
        className="pointer-events-none absolute z-10 size-2.5 -translate-y-1/2 rounded-full bg-rose-500 ring-2 ring-background"
        style={{ top, left: -5 }}
      />
    </>
  );
}

/** Whether an event's [start, end) overlaps the day containing `day`. */
function overlaps(day: Date, start: Date, end: Date): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = addMinutes(dayStart, MINUTES_PER_DAY);
  return start < dayEnd && end > dayStart;
}

/** Localized "9:15 AM"-style label for minutes-from-midnight on `day`. */
function formatMinutesLabel(day: Date, minutes: number): string {
  return addMinutes(startOfDay(day), minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whether `d` falls on a Saturday or Sunday. */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Source-aware tint — translucent fill plus a solid left accent edge so
 * blocks read as colour-coded at a glance even when tiny. Meetings → blue,
 * tasks → amber (matches kanban-card), external Google → green, external
 * Microsoft → indigo. An explicit `event.color` overrides via inline style
 * in `EventBlock` itself.
 */
function eventTint(event: CalendarEvent): string {
  if (event.source === "meeting") {
    return "border-l-blue-500 bg-blue-500/10 text-blue-900 ring-blue-500/20 dark:text-blue-100";
  }
  if (event.source === "task") {
    return "border-l-amber-500 bg-amber-500/10 text-amber-900 ring-amber-500/20 dark:text-amber-100";
  }
  if (event.source === "booking") {
    return "border-l-violet-500 bg-violet-500/10 text-violet-900 ring-violet-500/20 dark:text-violet-100";
  }
  if (event.provider === "google") {
    return "border-l-emerald-500 bg-emerald-500/10 text-emerald-900 ring-emerald-500/20 dark:text-emerald-100";
  }
  return "border-l-indigo-500 bg-indigo-500/10 text-indigo-900 ring-indigo-500/20 dark:text-indigo-100";
}
