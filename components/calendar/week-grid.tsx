"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
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
import type { CalendarEvent } from "@/lib/calendar/types";

const HOUR_HEIGHT_PX = 48;
const SNAP_MINUTES = 15;

type Props = {
  /** 1 element = day view; 7 = week view. */
  days: Date[];
  events: CalendarEvent[];
  propertyId: string;
  overlayUsers: Set<string>;
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
  onCreateSlot,
  onSelectEvent,
}: Props) {
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
            className="flex flex-1 flex-col gap-1 border-r border-border px-1.5 py-1.5"
          >
            <DayHeader date={d} />
            <div className="flex flex-col gap-1">
              {(allDayByDay[d.toDateString()] ?? []).map((ev) => (
                <button
                  key={`${ev.source}:${ev.id}`}
                  type="button"
                  onClick={() => onSelectEvent(ev)}
                  className={cn(
                    "truncate rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium",
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
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-sm font-medium",
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
        <div
          key={h}
          className="flex items-start justify-end pr-1.5 pt-0.5 text-[10px] text-muted-foreground"
          style={{ height: HOUR_HEIGHT_PX }}
        >
          {h === 0 ? "" : formatHourLabel(h)}
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
  onCreateSlot,
  onSelectEvent,
}: {
  day: Date;
  events: CalendarEvent[];
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
  const droppable = useDroppable({
    id: `calendar-day:${day.toDateString()}`,
    data: { kind: "calendar-day", date: day.toISOString() },
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
        droppable.isOver && "bg-primary/5",
      )}
      style={{ height: HOUR_HEIGHT_PX * 24 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Hour rule lines */}
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: h * HOUR_HEIGHT_PX }}
        />
      ))}

      {/* Now-line: only on today's column */}
      {isSameDay(day, new Date()) ? <NowLine /> : null}

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

      {/* Drag preview */}
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
        "absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] shadow-sm ring-1 ring-inset transition-shadow hover:shadow",
        eventTint(event),
      )}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
      }}
    >
      <EventBlock event={event} />
    </button>
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
        className="pointer-events-none absolute inset-x-0 z-10 h-px bg-rose-500"
        style={{ top }}
      />
      <div
        className="pointer-events-none absolute z-10 size-2 -translate-y-1/2 rounded-full bg-rose-500"
        style={{ top, left: -4 }}
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

/**
 * Source-aware tint. Meetings → blue, tasks → amber (matches kanban-card),
 * external Google → green, external Microsoft → indigo. An explicit
 * `event.color` overrides via inline style in `EventBlock` itself.
 */
function eventTint(event: CalendarEvent): string {
  if (event.source === "meeting") {
    return "bg-blue-500/10 text-blue-900 ring-blue-500/30 dark:text-blue-100";
  }
  if (event.source === "task") {
    return "bg-amber-500/10 text-amber-900 ring-amber-500/30 dark:text-amber-100";
  }
  if (event.provider === "google") {
    return "bg-emerald-500/10 text-emerald-900 ring-emerald-500/30 dark:text-emerald-100";
  }
  return "bg-indigo-500/10 text-indigo-900 ring-indigo-500/30 dark:text-indigo-100";
}
