import { Video } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * Inner contents of a positioned event block on the grid. The outer
 * `<button>` (in `WeekGrid`) owns the positioning, tint, custom-colour
 * override, and click handler; this component just renders the contents.
 */
export function EventBlock({ event }: { event: CalendarEvent }) {
  const start = new Date(event.start);
  const startLabel = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1">
        {event.source === "meeting" ? (
          <Video className="size-3 shrink-0 opacity-70" />
        ) : null}
        <span className="truncate font-medium">{event.title}</span>
      </div>
      <div className="truncate text-xs tabular-nums opacity-70">
        {startLabel}
      </div>
    </div>
  );
}
