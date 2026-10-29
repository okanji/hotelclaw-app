"use client";

import { isDone } from "@/lib/tasks/statuses";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { memberHue } from "@/components/gr8r/home-glyphs";
import {
  SOURCE_G8,
  SOURCE_LABEL,
  g8c,
} from "@/components/gr8r/calendar-glyphs";
import { toast } from "sonner";
import {
  useBroadcastEvent,
  useEventListener,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import { cn } from "@/lib/utils";
import {
  addDays,
  addMinutes,
  MINUTES_PER_DAY,
  snapToGrain,
  startOfDay,
  startOfWeek,
  weekDays,
} from "@/lib/calendar/time";
import {
  CALENDAR_VIEWS,
  shiftFocusDate,
  viewRange,
  VIEW_SHORTCUTS,
  type CalendarView,
} from "@/lib/calendar/view-range";
import {
  calendarEventsQueryOptions,
  freeBusyQueryOptions,
} from "@/lib/calendar/query-options";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import { scheduleTask } from "@/lib/calendar/actions";
import { rescheduleTask } from "@/components/tasks/actions";
import { useCalendarPrefs } from "./calendar-prefs-context";
import { WeekGrid } from "./week-grid";
import { MonthGrid } from "./month-grid";
import { YearGrid } from "./year-grid";
import { CalendarSourcesMenu } from "./calendar-sources-menu";
import { EventDialog } from "./event-dialog";
import { TeamOverlayPanel } from "./team-overlay-panel";
import {
  TaskChipGhost,
  TaskScheduleRail,
  type TaskDragData,
} from "./task-schedule-rail";
import { useCalendarRealtime } from "./use-calendar-realtime";
import { CalendarPresenceBar } from "./presence-bar";
import { AutomationsButton } from "@/components/workflows/automations-button";
import { PresenceCursors } from "./presence-cursors";
import { CalendarAiPanel } from "./calendar-ai-panel";
import { CalendarAiKnowledge } from "./calendar-ai-knowledge";
import { CalendarAiTools } from "./calendar-ai-tools";
import type { CalendarEvent, TaskEvent } from "@/lib/calendar/types";

const LEGEND = ["meeting", "task"] as const;

const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

/** "May 18 – 24, 2026" / "May 18, 2026" / "May 2026" / "2026". */
function formatRange(view: CalendarView, focus: Date): string {
  if (view === "year") return String(focus.getFullYear());
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
  const {
    focusDate,
    setFocusDate,
    view,
    setView,
    hiddenSources,
    overlayUsers,
  } = useCalendarPrefs();

  // The fetched window per view (`viewRange`: month pads ±1 week for the
  // grid's spill-over rows; year is Jan 1 → next Jan 1 for the density map).
  const range = useMemo(() => {
    const r = viewRange(view, focusDate);
    return { from: r.from.toISOString(), to: r.to.toISOString() };
  }, [focusDate, view]);

  // D / W / M / Y switch views (Google Calendar's letters). Bare keys only:
  // never while typing, never with a modifier, never inside an open dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
          el.closest("[role=dialog]"))
      ) {
        return;
      }
      const next = VIEW_SHORTCUTS[e.key.toLowerCase()];
      if (!next) return;
      e.preventDefault();
      setView(next);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setView]);

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
  const tasksQuery = useQuery(tasksQueryOptions(propertyId));

  // Deadlines: tasks with a due date but no scheduled window become all-day
  // chips on their due day (the amber task tint, prefixed "Due" in month
  // view). Scheduled tasks already arrive as time blocks from the events
  // endpoint, so only due-only ones are synthesised here; done tasks stay
  // off the grid — a met deadline is noise on a planning surface.
  const deadlineEvents = useMemo<TaskEvent[]>(() => {
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    const out: TaskEvent[] = [];
    for (const t of tasksQuery.data ?? []) {
      if (!t.due_at || t.scheduled_start || isDone(t)) continue;
      const due = new Date(t.due_at);
      if (Number.isNaN(due.getTime())) continue;
      const day = startOfDay(due);
      const dayMs = day.getTime();
      if (dayMs >= to || dayMs + MINUTES_PER_DAY * 60_000 <= from) continue;
      out.push({
        id: t.id,
        source: "task",
        title: t.title,
        description: t.description ?? null,
        location: null,
        color: null,
        all_day: true,
        start: day.toISOString(),
        end: addMinutes(day, MINUTES_PER_DAY).toISOString(),
        status: t.status,
        priority: t.priority,
        assignee_id: t.assignee_id,
        due_at: t.due_at,
        due_only: true,
      });
    }
    return out;
  }, [tasksQuery.data, range.from, range.to]);

  // Deterministic per-user colour — gr8r's `memberHue` (a `--g8-*` palette
  // token keyed on a hash of the id), the same colour the team panel's
  // swatch and the grid's free/busy lanes draw, on every teammate's screen.
  const userColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membersQuery.data ?? []) map.set(m.id, memberHue(m.id));
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
    const kind = event.active.data.current?.kind;
    if (kind === "task" || kind === "task-due") {
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
    const data = event.active.data.current as TaskDragData | undefined;
    if (!data || (data.kind !== "task" && data.kind !== "task-due")) return;
    const taskId = data.taskId;
    const overKind = event.over?.data.current?.kind as string | undefined;
    const overDate = event.over
      ? new Date((event.over.data.current as { date: string }).date)
      : null;

    // Month cell: a deadline chip moves its due date (keeping the time of
    // day); a rail chip gets a default 9–10am block on that day.
    if (overKind === "calendar-month-day" && overDate) {
      if (data.kind === "task-due") {
        const prev = data.dueAt ? new Date(data.dueAt) : null;
        const next = startOfDay(overDate);
        if (prev && !Number.isNaN(prev.getTime())) {
          next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        } else {
          next.setHours(17, 0, 0, 0);
        }
        if (prev && startOfDay(prev).getTime() === startOfDay(next).getTime()) return;
        qc.setQueryData<{ id: string; due_at: string | null }[]>(
          ["tasks", propertyId],
          (list) =>
            (list ?? []).map((t) =>
              t.id === taskId ? { ...t, due_at: next.toISOString() } : t,
            ),
        );
        const result = await rescheduleTask({ taskId, dueAt: next.toISOString() });
        if ("error" in result) toast.error(result.error);
        else
          toast.success(
            `Due ${next.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`,
          );
        qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
        broadcast({ type: "calendar-invalidate" });
        return;
      }
      const start = addMinutes(startOfDay(overDate), 9 * 60);
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
      return;
    }

    const dropDate = overKind === "calendar-day" ? overDate : null;
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

  // Apply the Calendars popover's show/hide filter client-side. The query stays
  // dense; CSS-level filtering keeps round-trips at zero when the user
  // toggles a calendar's visibility.
  const events = useMemo<CalendarEvent[]>(() => {
    const all: CalendarEvent[] = [...(eventsQuery.data ?? []), ...deadlineEvents];
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
  }, [eventsQuery.data, deadlineEvents, hiddenSources]);

  // Event-creation dialog. `prefill` carries the slot the user clicked or
  // dragged, so the dialog opens with the right start/end already filled.
  const [dialog, setDialog] = useState<
    | null
    | { mode: "create"; start: Date; end: Date }
    | { mode: "edit"; event: CalendarEvent; view?: "details" | "edit" }
  >(null);

  function shiftFocus(direction: -1 | 1) {
    setFocusDate(shiftFocusDate(view, focusDate, direction));
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
    {/* gr8r `pageWsCalendar()`: the topbar (`PageHeader`), then a flush
        `.page` with the `.ph` header (title + lede + actions) and the
        calendar's `.toolbar` (Today · ‹ › · range · legend · view `.seg`).
        `relative overflow-x-clip` anchors the slide-in AI panel to this
        surface and clips it when translated off. */}
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-x-clip">
      <PageHeader title="Calendar" icon={<CalendarDays />} />
      <div className="page flush min-h-0 flex-1">
        <div className="ph">
          <div>
            <h1>Calendar</h1>
            <p>Meetings, deadlines and your connected calendars.</p>
          </div>
          <div className="acts">
            <CalendarPresenceBar />
            <AutomationsButton propertyId={propertyId} feature="calendar" />
            <button
              type="button"
              className={aiOpen ? "btn btn-secondary on" : "btn btn-secondary"}
              aria-pressed={aiOpen}
              onClick={() => setAiOpen((v) => !v)}
            >
              <Gi icon={MessageSquareText} size={14} />
              Ask Claude
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const start = new Date();
                const end = new Date(start.getTime() + 60 * 60_000);
                setDialog({ mode: "create", start, end });
              }}
            >
              <Gi icon={Plus} size={14} />
              New event
            </button>
          </div>
        </div>

        <div className="toolbar" role="toolbar" aria-label="Calendar" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setFocusDate(new Date())}
          >
            Today
          </button>
          <div className="row" style={{ gap: 0 }}>
            <button
              type="button"
              className="ibtn ibtn-sm"
              onClick={() => shiftFocus(-1)}
              aria-label={`Previous ${view}`}
            >
              <Gi icon={ChevronLeft} size={16} />
            </button>
            <button
              type="button"
              className="ibtn ibtn-sm"
              onClick={() => shiftFocus(1)}
              aria-label={`Next ${view}`}
            >
              <Gi icon={ChevronRight} size={16} />
            </button>
          </div>
          <h2 className="cal-title" aria-live="polite">
            {formatRange(view, focusDate)}
          </h2>
          <span className="sp" />
          <span className="cal-legend hide-m" aria-hidden>
            {LEGEND.map((k) => (
              <span key={k}>
                <span className="pdot" style={g8c(SOURCE_G8[k])} />
                {SOURCE_LABEL[k]}
              </span>
            ))}
          </span>
          <div className="seg" role="tablist" aria-label="Calendar view">
            {CALENDAR_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={view === v ? "on" : ""}
                title={`${VIEW_LABEL[v]} view (${v[0].toUpperCase()})`}
                onClick={() => setView(v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <CalendarSourcesMenu propertyId={propertyId} />
        </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {view === "year" ? (
            <YearGrid
              focusDate={focusDate}
              events={events}
              onSelectDay={(d) => {
                setFocusDate(d);
                setView("day");
              }}
            />
          ) : view === "month" ? (
            <MonthGrid
              focusDate={focusDate}
              events={events}
              onSelectDay={(d) => setFocusDate(d)}
              onOpenDay={(d) => {
                setFocusDate(d);
                setView("day");
              }}
              onCreateOnDay={(d) => {
                const start = addMinutes(startOfDay(d), 9 * 60);
                setDialog({ mode: "create", start, end: addMinutes(start, 60) });
              }}
              onSelectEvent={(event) => setDialog({ mode: "edit", event })}
            />
          ) : (
            <WeekGrid
              days={days}
              events={events}
              propertyId={propertyId}
              currentUserId={currentUserId}
              overlayUsers={overlayUsers}
              freeBusy={freeBusyQuery.data ?? []}
              userColors={userColors}
              onCreateSlot={(start, end) =>
                setDialog({ mode: "create", start, end })
              }
              onEditEvent={(event) =>
                setDialog({ mode: "edit", event, view: "edit" })
              }
              onMutated={() => broadcast({ type: "calendar-invalidate" })}
            />
          )}
          {/* Peer cursors overlaying the grid. */}
          <PresenceCursors />
        </div>
        {/* Right rail — unscheduled tasks fill the column, team availability
            stays pinned at the bottom. The wrapper hides itself when both
            panels render null. */}
        <div className="cal-rail hidden lg:has-[section]:flex">
          <TaskScheduleRail propertyId={propertyId} />
          <TeamOverlayPanel
            propertyId={propertyId}
            currentUserId={currentUserId}
          />
        </div>
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
    <PortalDragOverlay dropAnimation={null}>
      {dragTask ? (
        // Fade out (never unmount) over the grid: the overlay's rect feeds
        // dnd-kit's collision detection, so unmounting it mid-drag makes
        // `over` flicker to null and the drop silently no-op.
        <div
          className={cn(
            "g8 cal-ghost transition-opacity duration-100",
            overGrid && "opacity-0",
          )}
        >
          <TaskChipGhost
            title={dragTask.title}
            priority={dragTask.priority}
          />
        </div>
      ) : null}
    </PortalDragOverlay>
    </DndContext>
  );
}
