"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
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
    <div className="grid h-full min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-auto">
      {cells.map((cell) => {
        const inMonth = cell.getMonth() === focusDate.getMonth();
        const isToday = isSameDay(cell, today);
        const list = eventsByDay.get(cell.toDateString()) ?? [];
        const visible = list.slice(0, MAX_EVENTS_PER_CELL);
        const overflow = list.length - visible.length;
        return (
          <button
            key={cell.toISOString()}
            type="button"
            onClick={() => onSelectDay(cell)}
            className={cn(
              "flex min-h-24 flex-col gap-1 border-r border-b border-border p-1.5 text-left transition-colors hover:bg-accent/30",
              !inMonth && "bg-muted/30 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "ml-auto inline-flex size-5 items-center justify-center rounded-full text-[11px]",
                isToday && "bg-primary text-primary-foreground font-medium",
              )}
            >
              {cell.getDate()}
            </span>
            <div className="flex flex-col gap-0.5">
              {visible.map((ev) => (
                <span
                  key={`${ev.source}:${ev.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent(ev);
                  }}
                  className={cn(
                    "truncate rounded-sm px-1 py-0.5 text-[11px] leading-tight",
                    ev.source === "meeting" &&
                      "bg-blue-500/15 text-blue-900 dark:text-blue-100",
                    ev.source === "task" &&
                      "bg-amber-500/15 text-amber-900 dark:text-amber-100",
                    ev.source === "external" &&
                      ev.provider === "google" &&
                      "bg-emerald-500/15 text-emerald-900 dark:text-emerald-100",
                    ev.source === "external" &&
                      ev.provider === "microsoft" &&
                      "bg-indigo-500/15 text-indigo-900 dark:text-indigo-100",
                  )}
                >
                  {ev.title}
                </span>
              ))}
              {overflow > 0 ? (
                <span className="text-[10px] text-muted-foreground">
                  +{overflow} more
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
