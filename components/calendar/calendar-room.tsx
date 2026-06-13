"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, MessageSquareText, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  useBroadcastEvent,
  useEventListener,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addDays,
  addMinutes,
  endOfDay,
  endOfWeek,
  MINUTES_PER_DAY,
  snapToGrain,
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
import {
  TaskChipGhost,
  TaskScheduleRail,
  type TaskDragData,
} from "./task-schedule-rail";
import { useCalendarRealtime } from "./use-calendar-realtime";
import { CalendarPresenceBar } from "./presence-bar";
import { PresenceCursors } from "./presence-cursors";
import { CalendarAiPanel } from "./calendar-ai-panel";
import { CalendarAiKnowledge } from "./calendar-ai-knowledge";
import { CalendarAiTools } from "./calendar-ai-tools";
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

  const qc = useQueryClient();

  // Liveblocks room broadcast: any peer that mutated the calendar fires
  // `calendar-invalidate` on save. We listen and invalidate immediately,
  // skipping the Supabase Realtime round-trip lag. The realtime hook
  // still runs as a fallback in case the room isn't connected.
  const broadcast = useBroadcastEvent();
  useEventListener(({ event }) => {
    if (event.type === "calendar-invalidate") {
      qc.invalidateQueries({ queryKey: ["calendar-events", propertyId] });
    }
  });

  // Tell peers what day we're on (drives the avatar-stack tooltip).
  const updatePresence = useUpdateMyPresence();
  useEffect(() => {
    updatePresence({ focusedDay: focusDate.toISOString() });
  }, [focusDate, updatePresence]);

  const [aiOpen, setAiOpen] = useState(false);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Task being dragged from the rail — drives the DragOverlay ghost. The
  // overlay portals to the body, so the ghost stays visible over the grid
  // instead of being clipped by the rail's overflow.
  const [dragTask, setDragTask] = useState<TaskDragData | null>(null);
  // Whether the dragged chip is currently over a day column. The chip
  // ghost hides there so it doesn't cover the in-column drop preview —
  // the preview (snapped block + time label) takes over as the cursor's
  // representation, Google Calendar style.
  const [overGrid, setOverGrid] = useState(false);

  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.kind === "task") {
      setDragTask(event.active.data.current as TaskDragData);
      setOverGrid(false);
    }
  }

  // dnd-kit drop handler — a task chip from `TaskScheduleRail` drops onto
  // one of the `calendar-day:<dateString>` droppables. The start time
  // comes from where the chip lands in the column (snapped to 15 min,
  // falling back to 9am if rects are unavailable), with a 1-hour default
  // block the user can refine in the event dialog.
  async function handleDragEnd(event: DragEndEvent) {
    setDragTask(null);
    setOverGrid(false);
    const taskId =
      event.active.data.current?.kind === "task"
        ? (event.active.data.current as TaskDragData).taskId
        : null;
    if (!taskId) return;
    const dropDate =
      event.over?.data.current?.kind === "calendar-day"
        ? new Date((event.over.data.current as { date: string }).date)
        : null;
    if (!dropDate) return;
    // Resolve the drop time from where the ghost chip's top edge lands in
    // the column. Both rects are viewport-space: `over.rect` stays live via
    // dnd-kit's measuring, and `translated` is the DragOverlay's rendered
    // position. (Don't use `event.delta` for this — it's scroll-adjusted,
    // so any container scroll during the drag skews it.)
    const overRect = event.over?.rect;
    const chipRect = event.active.rect.current.translated;
    let startMinutes = 9 * 60;
    if (overRect && chipRect && overRect.height > 0) {
      const raw =
        ((chipRect.top - overRect.top) / overRect.height) * MINUTES_PER_DAY;
      startMinutes = Math.max(
        0,
        Math.min(MINUTES_PER_DAY - 60, snapToGrain(raw, 15)),
      );
    }
    const start = addMinutes(startOfDay(dropDate), startMinutes);
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
    broadcast({ type: "calendar-invalidate" });
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
      if (e.source === "booking") {
        return !hiddenSources.has("internal:bookings");
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
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={(e) =>
        setOverGrid(e.over?.data.current?.kind === "calendar-day")
      }
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDragTask(null);
        setOverGrid(false);
      }}
    >
    {/* `relative overflow-x-clip` anchors the slide-in AI panel to this
        surface and clips it when translated off — without it, the panel's
        absolute positioning resolved against a wider ancestor and its
        closed state peeked back into the viewport as a stray strip. */}
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-x-clip">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
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
          <h1 className="text-base font-semibold tracking-tight tabular-nums">
            {formatRange(view, focusDate)}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <CalendarPresenceBar />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiOpen((v) => !v)}
          >
            <MessageSquareText className="size-4" />
            Ask Claude
          </Button>
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
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
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
          {/* Peer cursors overlaying the grid. Positioned absolute inside
              this `relative` wrapper so they line up with the time grid
              regardless of how the rails on the right compress it. */}
          <PresenceCursors />
        </div>
        {/* Right rail — unscheduled tasks fill the column, team availability
            stays pinned at the bottom instead of being pushed off-screen by
            a long task list. The wrapper owns the border/background (and
            hides itself when both panels render null) so an empty panel
            never leaves an unstyled gap in the column. */}
        <div className="hidden min-h-0 shrink-0 flex-col border-l border-border bg-muted/20 lg:has-[aside]:flex">
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
          onMutated={() => broadcast({ type: "calendar-invalidate" })}
        />
      ) : null}

      {/* AI plumbing — mounted unconditionally so the copilot always sees
          fresh knowledge (current events, members, focus date) regardless
          of whether the panel is open. The tools register globally for the
          chat too. The panel itself is what slides in/out. */}
      <CalendarAiKnowledge
        propertyId={propertyId}
        events={events}
        members={membersQuery.data ?? []}
        focusDate={focusDate}
      />
      <CalendarAiTools
        propertyId={propertyId}
        currentUserId={currentUserId}
        broadcastInvalidate={() =>
          broadcast({ type: "calendar-invalidate" })
        }
      />
      <CalendarAiPanel
        propertyId={propertyId}
        currentUserId={currentUserId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </section>
    <DragOverlay dropAnimation={null}>
      {dragTask ? (
        // Fade out (never unmount) over the grid: the overlay's rect feeds
        // dnd-kit's collision detection, so unmounting it mid-drag makes
        // `over` flicker to null and the drop silently no-op.
        <div
          className={cn(
            "transition-opacity duration-100",
            overGrid && "opacity-0",
          )}
        >
          <TaskChipGhost
            title={dragTask.title}
            priority={dragTask.priority}
          />
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
