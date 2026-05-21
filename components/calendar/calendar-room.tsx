"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addDays,
  addMinutes,
  endOfDay,
  endOfWeek,
  startOfDay,
  startOfWeek,
  weekDays,
} from "@/lib/calendar/time";
import {
  calendarEventsQueryOptions,
  freeBusyQueryOptions,
} from "@/lib/calendar/query-options";
import { propertyMembersQueryOptions } from "@/lib/query/section-queries";
import { scheduleTask } from "@/lib/calendar/actions";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { WeekGrid } from "./week-grid";
import { MonthGrid } from "./month-grid";
import { EventDialog } from "./event-dialog";
import { TeamOverlayPanel } from "./team-overlay-panel";
import { TaskScheduleRail } from "./task-schedule-rail";
import { useCalendarRealtime } from "./use-calendar-realtime";
import type { CalendarEvent } from "@/lib/calendar/types";

/** "May 18 – 24, 2026" / "May 18, 2026" / "May 2026". */
function formatRange(view: "day" | "week" | "month", focus: Date): string {
  if (view === "day") {
    return focus.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "month") {
    return focus.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const start = startOfWeek(focus);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
    })} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/**
 * The calendar page body — header (range + navigation + "New event"),
 * grid (week/day/month, picked by prefs), and the slide-in event dialog.
 *
 * Data lives in a single `useQuery` keyed on the rounded query window so
 * the grid can stay populated when the user pages between weeks. Realtime
 * invalidations come from `useCalendarRealtime`.
 */
export function CalendarRoom({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  const { focusDate, setFocusDate, view, hiddenSources, overlayUsers } =
    useCalendarPrefs();

  // Query a slightly larger window than the visible viewport so an event
  // partially crossing the boundary stays in the cache when the user pages.
  const range = useMemo(() => {
    if (view === "day") {
      const start = startOfDay(focusDate);
      return { from: start.toISOString(), to: endOfDay(start).toISOString() };
    }
    if (view === "month") {
      const monthStart = new Date(focusDate);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      // Pad ±1 week so the surrounding weeks of the 6-row grid have data.
      return {
        from: addDays(monthStart, -7).toISOString(),
        to: addDays(monthEnd, 7).toISOString(),
      };
    }
    const start = startOfWeek(focusDate);
    return {
      from: start.toISOString(),
      to: endOfWeek(focusDate).toISOString(),
    };
  }, [focusDate, view]);

  useCalendarRealtime(propertyId, currentUserId);

  const eventsQuery = useQuery(
    calendarEventsQueryOptions(propertyId, range),
  );
  const overlayList = useMemo(
    () => Array.from(overlayUsers),
    [overlayUsers],
  );
  const freeBusyQuery = useQuery(
    freeBusyQueryOptions(propertyId, overlayList, range),
  );
  const membersQuery = useQuery(propertyMembersQueryOptions(propertyId));

  // Deterministic per-user colour palette — keyed on a hash of the id so
  // the same user gets the same colour across renders, sessions, and
  // teammates' screens. Avoids "Alice is teal here but blue on Bob's
  // calendar" confusion.
  const userColors = useMemo(() => {
    const palette = [
      "ef4444",
      "f97316",
      "eab308",
      "22c55e",
      "06b6d4",
      "3b82f6",
      "8b5cf6",
      "ec4899",
    ];
    const map = new Map<string, string>();
    for (const m of membersQuery.data ?? []) {
      let h = 0;
      for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
      map.set(m.id, palette[Math.abs(h) % palette.length]);
    }
    return map;
  }, [membersQuery.data]);

  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // dnd-kit drop handler — a task chip from `TaskScheduleRail` drops onto
  // one of the `calendar-day:<dateString>` droppables. We snap to the top
  // of the day for the start, and give the task a 1-hour default block
  // (good enough for v1; the user can refine in the event dialog).
  async function handleDragEnd(event: DragEndEvent) {
    const taskId =
      event.active.data.current?.kind === "task"
        ? (event.active.data.current as { taskId: string }).taskId
        : null;
    if (!taskId) return;
    const dropDate =
      event.over?.data.current?.kind === "calendar-day"
        ? new Date((event.over.data.current as { date: string }).date)
        : null;
    if (!dropDate) return;
    const start = new Date(dropDate);
    start.setHours(9, 0, 0, 0);
    const end = addMinutes(start, 60);
    const result = await scheduleTask({
      propertyId,
      taskId,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Task scheduled");
    qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
  }

  // Apply the sidebar's hide-checkbox filter client-side. The query stays
  // dense; CSS-level filtering keeps round-trips at zero when the user
  // toggles a calendar's visibility.
  const events = useMemo<CalendarEvent[]>(() => {
    const all = eventsQuery.data ?? [];
    if (hiddenSources.size === 0) return all;
    return all.filter((e) => {
      if (e.source === "meeting") {
        return !hiddenSources.has("internal:meetings");
      }
      if (e.source === "task") {
        return !hiddenSources.has("internal:tasks");
      }
      return !hiddenSources.has(e.calendar_id);
    });
  }, [eventsQuery.data, hiddenSources]);

  // Event-creation dialog. `prefill` carries the slot the user clicked or
  // dragged, so the dialog opens with the right start/end already filled.
  const [dialog, setDialog] = useState<
    | null
    | { mode: "create"; start: Date; end: Date }
    | { mode: "edit"; event: CalendarEvent }
  >(null);

  function shiftFocus(direction: -1 | 1) {
    const next = new Date(focusDate);
    if (view === "day") next.setDate(next.getDate() + direction);
    else if (view === "month") next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + 7 * direction);
    setFocusDate(next);
  }

  const days = view === "week" ? weekDays(focusDate) : [startOfDay(focusDate)];

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <section className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFocusDate(new Date())}
          >
            Today
          </Button>
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shiftFocus(-1)}
              aria-label="Previous"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => shiftFocus(1)}
              aria-label="Next"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h1 className="text-base font-medium">
            {formatRange(view, focusDate)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              const start = new Date();
              const end = new Date(start.getTime() + 60 * 60_000);
              setDialog({ mode: "create", start, end });
            }}
          >
            <Plus className="size-4" />
            New event
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {view === "month" ? (
            <MonthGrid
              focusDate={focusDate}
              events={events}
              onSelectDay={(d) => setFocusDate(d)}
              onSelectEvent={(event) => setDialog({ mode: "edit", event })}
            />
          ) : (
            <WeekGrid
              days={days}
              events={events}
              propertyId={propertyId}
              overlayUsers={overlayUsers}
              freeBusy={freeBusyQuery.data ?? []}
              userColors={userColors}
              onCreateSlot={(start, end) =>
                setDialog({ mode: "create", start, end })
              }
              onSelectEvent={(event) => setDialog({ mode: "edit", event })}
            />
          )}
        </div>
        <div className="flex shrink-0 flex-col">
          <TaskScheduleRail propertyId={propertyId} />
          <TeamOverlayPanel
            propertyId={propertyId}
            currentUserId={currentUserId}
          />
        </div>
      </div>

      {dialog ? (
        <EventDialog
          propertyId={propertyId}
          currentUserId={currentUserId}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          initial={dialog}
        />
      ) : null}
    </section>
    </DndContext>
  );
}
