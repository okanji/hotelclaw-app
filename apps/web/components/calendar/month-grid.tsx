"use client";

import { isDone } from "@/lib/tasks/statuses";
import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { PrIcon } from "@/components/gr8r/home-glyphs";
import { evStyle, shortTime } from "@/components/gr8r/calendar-glyphs";
import {
  isSameDay,
  monthGrid,
  startOfDay,
  addMinutes,
  MINUTES_PER_DAY,
} from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { TaskDragData } from "./task-schedule-rail";

const MAX_EVENTS_PER_CELL = 3;

/**
 * Month view — gr8r's `.cal` month (`calendarHtml`, src/views/calendar.js):
 * `.cal-h` weekday row, `.cal-g` 6×7 grid of `.cday` cells (`.out` for the
 * spill-over days, `.today`, `.over` while a drag hovers), a hover `+` that
 * creates an event on that day, up to three `.cev` chips and a `.cmore`
 * "+N more" that opens Day view. Timed sources (meetings,
 * external) read as gr8r's dashed `.cev.event` with a time prefix; tasks are
 * the solid tinted chip. Clicking a cell jumps the focusDate; clicking an
 * event opens the event dialog (delegated up).
 *
 * Every cell is a dnd-kit droppable (`calendar-month-day:<date>`): a
 * deadline chip (due-only task) dragged onto another day moves its due date,
 * and a chip from the unscheduled rail dropped on a day schedules it there.
 */
export function MonthGrid({
  focusDate,
  events,
  onSelectDay,
  onOpenDay,
  onCreateOnDay,
  onSelectEvent,
}: {
  focusDate: Date;
  events: CalendarEvent[];
  onSelectDay: (d: Date) => void;
  /** "+N more" / the date number — opens Day view on that day. */
  onOpenDay: (d: Date) => void;
  /** The cell's hover `+` — a new event on that day. */
  onCreateOnDay: (d: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const cells = monthGrid(focusDate);
  const today = new Date();

  // Pre-bucket every event into the days it touches so the cell loop is O(1).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const cell of cells) {
      map.set(cell.toDateString(), []);
    }
    for (const ev of events) {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      for (const cell of cells) {
        const cellStart = startOfDay(cell);
        const cellEnd = addMinutes(cellStart, MINUTES_PER_DAY);
        if (start < cellEnd && end > cellStart) {
          map.get(cell.toDateString())!.push(ev);
        }
      }
    }
    return map;
  }, [cells, events]);

  return (
    <div className="cal-scroll">
      <div className="cal">
        {/* Weekday header — labels derive from the grid's first row so they
            always match the configured week start. */}
        <div className="cal-h">
          {cells.slice(0, 7).map((d) => (
            <div key={d.toDateString()}>
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
          ))}
        </div>
        <div className="cal-g">
          {cells.map((cell) => (
            <MonthCell
              key={cell.toISOString()}
              cell={cell}
              inMonth={cell.getMonth() === focusDate.getMonth()}
              isToday={isSameDay(cell, today)}
              list={eventsByDay.get(cell.toDateString()) ?? []}
              onSelectDay={onSelectDay}
              onOpenDay={onOpenDay}
              onCreateOnDay={onCreateOnDay}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthCell({
  cell,
  inMonth,
  isToday,
  list,
  onSelectDay,
  onOpenDay,
  onCreateOnDay,
  onSelectEvent,
}: {
  cell: Date;
  inMonth: boolean;
  isToday: boolean;
  list: CalendarEvent[];
  onSelectDay: (d: Date) => void;
  onOpenDay: (d: Date) => void;
  onCreateOnDay: (d: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const visible = list.slice(0, MAX_EVENTS_PER_CELL);
  const overflow = list.length - visible.length;
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-month-day:${cell.toDateString()}`,
    data: { kind: "calendar-month-day", date: cell.toISOString() },
  });
  const dayLabel = cell.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
  const cls = ["cday", !inMonth && "out", isToday && "today", isOver && "over"]
    .filter(Boolean)
    .join(" ");
  return (
    // The cell surface is a pointer shortcut (jumps the focus date); the
    // date number, the `+` and the chips are the real controls — interactive
    // elements must not nest inside one another.
    <div ref={setNodeRef} onClick={() => onSelectDay(cell)} className={cls}>
      <button
        type="button"
        className="dn"
        aria-current={isToday ? "date" : undefined}
        aria-label={`Open ${dayLabel} in Day view`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenDay(cell);
        }}
      >
        {cell.getDate()}
      </button>
      <button
        type="button"
        className="ibtn ibtn-xs add"
        aria-label={`New event on ${dayLabel}`}
        onClick={(e) => {
          e.stopPropagation();
          onCreateOnDay(cell);
        }}
      >
        <Gi icon={Plus} size={13} />
      </button>
      {visible.map((ev) =>
        ev.source === "task" && ev.due_only ? (
          <DeadlineChip
            key={`${ev.source}:${ev.id}`}
            event={ev}
            onSelect={() => onSelectEvent(ev)}
          />
        ) : ev.source === "task" ? (
          <button
            key={`${ev.source}:${ev.id}`}
            type="button"
            className={isDone(ev) ? "cev done" : "cev"}
            style={evStyle(ev)}
            title={ev.title}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEvent(ev);
            }}
          >
            <PrIcon priority={ev.priority} size={11} />
            <span className="trunc">{ev.title}</span>
          </button>
        ) : (
          <button
            key={`${ev.source}:${ev.id}`}
            type="button"
            className="cev event"
            style={evStyle(ev)}
            title={ev.all_day ? ev.title : `${ev.title} · ${shortTime(ev.start)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEvent(ev);
            }}
          >
            {ev.all_day ? null : (
              <span className="num faint" style={{ fontSize: 11 }}>
                {shortTime(ev.start)}
              </span>
            )}
            <span className="trunc">{ev.title}</span>
          </button>
        ),
      )}
      {overflow > 0 ? (
        <button
          type="button"
          className="cmore"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDay(cell);
          }}
        >
          +{overflow} more
        </button>
      ) : null}
    </div>
  );
}

/**
 * A due-only task's chip — gr8r's draggable task `.cev` (priority glyph +
 * title, a quiet "Due" tag): drop it on another day to move the due date.
 * The chip stays in place while dragging (the room's DragOverlay carries
 * the ghost) and dims so the origin reads as "leaving".
 */
function DeadlineChip({
  event,
  onSelect,
}: {
  event: Extract<CalendarEvent, { source: "task" }>;
  onSelect: () => void;
}) {
  const data: TaskDragData = {
    kind: "task-due",
    taskId: event.id,
    title: event.title,
    priority: event.priority,
    dueAt: event.due_at ?? undefined,
  };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `deadline:${event.id}`,
    data,
  });
  const cls = ["cev drag", isDone(event) && "done", isDragging && "dragging"]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${event.title} · due — drag to another day to move`}
      className={cls}
      style={evStyle(event)}
    >
      <PrIcon priority={event.priority} size={11} />
      <span className="trunc">{event.title}</span>
      <span className="due-tag">Due</span>
    </button>
  );
}
