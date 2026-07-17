"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { eventChipClass } from "@/lib/calendar/event-visuals";
import {
  isSameDay,
  monthGrid,
  startOfDay,
  addMinutes,
  MINUTES_PER_DAY,
} from "@/lib/calendar/time";
import type { CalendarEvent } from "@/lib/calendar/types";

const MAX_EVENTS_PER_CELL = 3;

/**
 * Month view: 6×7 grid of day cells with up to three event chips per cell
 * and an "N more" pill when overflowing. Clicking a day jumps the
 * focusDate; clicking an event opens the event dialog (delegated up).
 */
export function MonthGrid({
  focusDate,
  events,
  onSelectDay,
  onSelectEvent,
}: {
  focusDate: Date;
  events: CalendarEvent[];
  onSelectDay: (d: Date) => void;
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
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Weekday header — labels derive from the grid's first row so they
          always match the configured week start. */}
      <div className="grid grid-cols-7 border-b border-border">
        {cells.slice(0, 7).map((d) => (
          <div
            key={d.toDateString()}
            className="px-2 py-1.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-auto">
      {cells.map((cell) => {
        const inMonth = cell.getMonth() === focusDate.getMonth();
        const isToday = isSameDay(cell, today);
        const isWeekend = cell.getDay() === 0 || cell.getDay() === 6;
        const list = eventsByDay.get(cell.toDateString()) ?? [];
        const visible = list.slice(0, MAX_EVENTS_PER_CELL);
        const overflow = list.length - visible.length;
        return (
          // The cell surface is a pointer shortcut; the date number is the
          // real (keyboard-reachable) control. Event chips are buttons too —
          // interactive elements must not nest inside one another.
          <div
            key={cell.toISOString()}
            onClick={() => onSelectDay(cell)}
            className={cn(
              "flex min-h-24 cursor-pointer flex-col gap-1 border-r border-b border-border p-1.5 text-left transition-colors hover:bg-accent/30",
              !inMonth && "bg-muted/30 text-muted-foreground",
              inMonth && isWeekend && "bg-muted/15",
              isToday && "bg-primary/4",
            )}
          >
            <button
              type="button"
              aria-label={`Open ${cell.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectDay(cell);
              }}
              className={cn(
                "ml-auto inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                isToday && "bg-primary text-primary-foreground font-medium",
              )}
            >
              {cell.getDate()}
            </button>
            <div className="flex flex-col gap-0.5">
              {visible.map((ev) => (
                <button
                  key={`${ev.source}:${ev.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(ev);
                  }}
                  className={cn(
                    "truncate rounded-sm px-1 py-0.5 text-left text-xs leading-tight focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    eventChipClass(ev),
                  )}
                >
                  {ev.title}
                </button>
              ))}
              {overflow > 0 ? (
                <span className="text-xs text-muted-foreground">
                  +{overflow} more
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
