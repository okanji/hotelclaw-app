import { Video } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import type { CalendarEvent } from "@/lib/calendar/types";

/**
 * Inner contents of a positioned event block on the grid — gr8r's
 * `.wcard` anatomy (`.t` title row, `.m` meta line) inside the `.tg-ev`
 * block. The outer trigger (in `WeekGrid`) owns positioning, tint and the
 * click handler.
 */
export function EventBlock({ event }: { event: CalendarEvent }) {
  const start = new Date(event.start);
  const startLabel = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <>
      <div className="t">
        {event.source === "meeting" ? <Gi icon={Video} size={12} /> : null}
        <span className="trunc">{event.title}</span>
      </div>
      <div className="m trunc">{startLabel}</div>
    </>
  );
}
