"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isSameDay,
  monthGrid,
  startOfMonth,
  WEEK_START,
} from "@/lib/calendar/time";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Compact month grid for the section sidebar. Click a day to set the
 * focusDate; arrows change the displayed month (independent of focus so the
 * user can pre-scroll without losing their place).
 */
export function MiniMonth({
  value,
  onChange,
}: {
  value: Date;
  onChange: (d: Date) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(value));
  const cells = monthGrid(cursor);
  const cursorMonth = cursor.getMonth();
  const today = new Date();

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center justify-between px-1 py-1.5">
        <span className="text-xs leading-3 font-medium text-faint-foreground">
          {cursor.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={() => {
              const next = new Date(cursor);
              next.setMonth(next.getMonth() - 1);
              setCursor(next);
            }}
            className="rounded-md p-1 text-faint-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              const next = new Date(cursor);
              next.setMonth(next.getMonth() + 1);
              setCursor(next);
            }}
            className="rounded-md p-1 text-faint-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            aria-label="Next month"
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-xs text-faint-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <span key={d} className="py-1">
            {d[0]}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const inMonth = d.getMonth() === cursorMonth;
          const selected = isSameDay(d, value);
          const isToday = isSameDay(d, today);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onChange(d)}
              className={cn(
                "flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors focus-visible:shadow-focus focus-visible:outline-none",
                !inMonth && "text-faint-foreground",
                inMonth && !selected && "text-secondary-ink",
                selected && "bg-accent-pressed font-medium text-foreground",
                !selected && isToday && "font-medium text-foreground",
                !selected && "hover:bg-accent",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {/* WEEK_START exported for tests; referenced here to keep the import
          local — the layout above assumes Mon-first. */}
      <span className="sr-only">Week starts on day {WEEK_START}</span>
    </div>
  );
}
