"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import { ChevronLeft, Layers } from "lucide-react";
import {
  addMinutes,
  isSameDay,
  layoutDayColumns,
  MINUTES_PER_DAY,
  minutesFromMidnight,
  snapToGrain,
  startOfDay,
} from "@/lib/calendar/time";
import { cn } from "@/lib/utils";
import { eventTint, eventDotClass, EVENT_VISUALS } from "@/lib/calendar/event-visuals";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EventBlock } from "./event-block";
import { EventDetailBody } from "./event-detail-body";
import type { CalendarEvent, FreeBusySlot } from "@/lib/calendar/types";

const HOUR_HEIGHT_PX = 48;
const SNAP_MINUTES = 15;
/**
 * Peak concurrency a slot can reach before we stop shingling and collapse the
 * pile into a single "+N events" tile. A day is one wide column so it can
 * cascade more blocks legibly; a week packs seven columns into the same width,
 * so it tips into the collapsed tile sooner.
 */
const MAX_SHINGLE_DAY = 3;
const MAX_SHINGLE_WEEK = 2;
/**
 * How far a shingled block widens past its own lane to overlap its neighbour,
 * as a multiple of the lane step. >1 produces the Google-style cascade where
 * each block peeks out from under the next; the clicked one lifts to the front.
 */
const SHINGLE_SPREAD = 1.7;

type Props = {
  /** 1 element = day view; 7 = week view. */
  days: Date[];
  events: CalendarEvent[];
  propertyId: string;
  currentUserId: string;
  overlayUsers: Set<string>;
  /**
   * Free/busy slots for the toggled overlay users. We don't pull these
   * inside this component — the room owns the query so cache keys stay
   * adjacent to the events query.
   */
  freeBusy: FreeBusySlot[];
  /** Stable per-user colour map (id → hex). Built in the room from the
   *  member palette so two grids in the same render don't disagree. */
  userColors: Map<string, string>;
  onCreateSlot: (start: Date, end: Date) => void;
  /** Open the modal editor on the form for an event (the popover's pencil). */
  onEditEvent: (event: CalendarEvent) => void;
  /** Broadcast a refresh to peers after an inline mutation (delete/RSVP). */
  onMutated?: () => void;
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
  propertyId,
  currentUserId,
  overlayUsers,
  freeBusy,
  userColors,
  onCreateSlot,
  onEditEvent,
  onMutated,
}: Props) {
  // Stable lane order keyed on `overlayUsers` membership — the renderer
  // draws each user's free/busy in their own lane down the right edge of
  // each column. Sets aren't ordered, so we sort by id for determinism.
  const lanes = useMemo(
    () => Array.from(overlayUsers).sort(),
    [overlayUsers],
  );
  // Index busy slots by day so each column lookup is O(1).
  const slotsByDay = useMemo(() => {
    const map = new Map<string, FreeBusySlot[]>();
    for (const slot of freeBusy) {
      if (slot.busy === "free") continue;
      const start = new Date(slot.start_at);
      const end = new Date(slot.end_at);
      // A slot can span multiple days — clamp each crossed day.
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      while (cursor < end) {
        const key = cursor.toDateString();
        const arr = map.get(key) ?? [];
        arr.push(slot);
        map.set(key, arr);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [freeBusy]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxShingle = days.length <= 1 ? MAX_SHINGLE_DAY : MAX_SHINGLE_WEEK;

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
            className={cn(
              "flex flex-1 flex-col gap-1 border-r border-border px-1.5 py-1.5",
              isWeekend(d) && "bg-muted/30",
              isSameDay(d, new Date()) && "bg-primary/4",
            )}
          >
            <DayHeader date={d} />
            <div className="flex flex-col gap-1">
              {(allDayByDay[d.toDateString()] ?? []).map((ev) => (
                <EventPopover
                  key={`${ev.source}:${ev.id}`}
                  event={ev}
                  propertyId={propertyId}
                  currentUserId={currentUserId}
                  onEditEvent={onEditEvent}
                  onMutated={onMutated}
                  triggerClassName={cn(
                    "truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-xs font-medium",
                    eventTint(ev),
                  )}
                >
                  {ev.title}
                </EventPopover>
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
            freeBusySlots={slotsByDay.get(day.toDateString()) ?? []}
            lanes={lanes}
            maxShingle={maxShingle}
            userColors={userColors}
            propertyId={propertyId}
            currentUserId={currentUserId}
            onCreateSlot={onCreateSlot}
            onEditEvent={onEditEvent}
            onMutated={onMutated}
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
      <span
        className={cn(
          "text-xs font-medium uppercase tracking-wide",
          today ? "text-primary" : "text-muted-foreground",
        )}
      >
        {date.toLocaleDateString(undefined, { weekday: "short" })}
      </span>
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-sm font-medium tabular-nums",
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
        <div key={h} className="relative" style={{ height: HOUR_HEIGHT_PX }}>
          {/* Label sits centered on the hour rule, Google Calendar style,
              rather than floating below it. */}
          {h > 0 ? (
            <div className="absolute inset-x-0 top-0 -translate-y-1/2 pr-2 text-right text-[10px] font-medium tabular-nums text-muted-foreground/80">
              {formatHourLabel(h)}
            </div>
          ) : null}
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
  freeBusySlots,
  lanes,
  maxShingle,
  userColors,
  propertyId,
  currentUserId,
  onCreateSlot,
  onEditEvent,
  onMutated,
}: {
  day: Date;
  events: CalendarEvent[];
  freeBusySlots: FreeBusySlot[];
  lanes: string[];
  maxShingle: number;
  userColors: Map<string, string>;
  propertyId: string;
  currentUserId: string;
  onCreateSlot: (start: Date, end: Date) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onMutated?: () => void;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startMin: number; endMin: number } | null>(
    null,
  );

  // dnd-kit drop target so a TaskCard dragged here can schedule on this day.
  // Drop payload uses the column's bounding rect to compute the dropped
  // y-position into minutes (done in onDragEnd at the parent).
  const droppableId = `calendar-day:${day.toDateString()}`;
  const droppable = useDroppable({
    id: droppableId,
    data: { kind: "calendar-day", date: day.toISOString() },
  });

  // Live drop preview for a task chip dragged over this column — a ghost
  // event block snapped to the 15-minute grid at the chip's top edge, so
  // the user sees exactly where (and when) the task will land before
  // releasing. Uses the same math as the room's onDragEnd so the preview
  // and the actual drop always agree.
  const [taskDrop, setTaskDrop] = useState<{
    startMin: number;
    title: string;
  } | null>(null);
  useDndMonitor({
    onDragMove(e) {
      const data = e.active.data.current as
        | { kind?: string; title?: string }
        | undefined;
      if (data?.kind !== "task") return;
      if (e.over?.id !== droppableId) {
        setTaskDrop(null);
        return;
      }
      const chipTop = e.active.rect.current.translated?.top;
      const colRect = columnRef.current?.getBoundingClientRect();
      if (chipTop == null || !colRect || colRect.height === 0) return;
      const raw =
        ((chipTop - colRect.top) / colRect.height) * MINUTES_PER_DAY;
      const startMin = Math.max(
        0,
        Math.min(MINUTES_PER_DAY - 60, snapToGrain(raw, SNAP_MINUTES)),
      );
      setTaskDrop((prev) =>
        prev?.startMin === startMin
          ? prev
          : { startMin, title: data.title ?? "" },
      );
    },
    onDragEnd() {
      setTaskDrop(null);
    },
    onDragCancel() {
      setTaskDrop(null);
    },
  });

  // layoutDayColumns reads `start` / `end` off each item — wrap each event so
  // it sees `Date` objects, then unwrap on the way out so the renderer keeps
  // the full `CalendarEvent` for click handling.
  const items = useMemo(() => {
    const wrapped = events.map((e) => ({
      event: e,
      start: new Date(e.start),
      end: new Date(e.end),
    }));
    return layoutDayColumns(wrapped, maxShingle);
  }, [events, maxShingle]);

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
        isWeekend(day) && "bg-muted/30",
        isSameDay(day, new Date()) && "bg-primary/4",
        droppable.isOver && "bg-primary/10",
      )}
      style={{ height: HOUR_HEIGHT_PX * 24 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Hour rule lines, with a fainter dashed rule on the half hour */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h}>
          <div
            className="absolute inset-x-0 border-t border-border/60"
            style={{ top: h * HOUR_HEIGHT_PX }}
          />
          <div
            className="absolute inset-x-0 border-t border-dashed border-border/30"
            style={{ top: h * HOUR_HEIGHT_PX + HOUR_HEIGHT_PX / 2 }}
          />
        </div>
      ))}

      {/* Now-line: only on today's column */}
      {isSameDay(day, new Date()) ? <NowLine /> : null}

      {/* Per-user free/busy lanes — translucent bars along the right edge.
          Each toggled-on user gets one narrow lane (max 4 lanes before we
          stop growing — beyond that we'd want a pop-out summary). */}
      {lanes.length > 0 ? (
        <FreeBusyLanes
          day={day}
          slots={freeBusySlots}
          lanes={lanes}
          userColors={userColors}
        />
      ) : null}

      {/* Timed events — shingled when a few overlap, collapsed into one
          "+N events" tile when a slot is too dense to read. */}
      {items.map((item) => {
        if (item.kind === "cluster") {
          const evs = item.events.map((w) => w.event);
          return (
            <ClusterTile
              key={`cluster:${evs[0].source}:${evs[0].id}`}
              day={day}
              start={item.start}
              end={item.end}
              count={item.count}
              events={evs}
              propertyId={propertyId}
              currentUserId={currentUserId}
              onEditEvent={onEditEvent}
              onMutated={onMutated}
            />
          );
        }
        const ev = item.event.event;
        return (
          <PositionedEvent
            key={`${ev.source}:${ev.id}`}
            day={day}
            event={ev}
            column={item.column}
            columns={item.columns}
            propertyId={propertyId}
            currentUserId={currentUserId}
            onEditEvent={onEditEvent}
            onMutated={onMutated}
          />
        );
      })}

      {/* Drag-to-create slot preview */}
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

      {/* Task-drop preview — ghost of the 1-hour block the task will
          occupy if released here, snapped to the 15-minute grid. */}
      {taskDrop ? (
        <div
          className={cn("pointer-events-none absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-2 py-1 pr-1.5 pl-2 text-left text-xs shadow-sm ring-1 ring-inset", EVENT_VISUALS.task.block)}
          style={{
            top: (taskDrop.startMin / 60) * HOUR_HEIGHT_PX,
            height: HOUR_HEIGHT_PX,
          }}
        >
          <div className="truncate font-medium">{taskDrop.title}</div>
          <div className="truncate text-xs tabular-nums opacity-70">
            {formatMinutesLabel(day, taskDrop.startMin)} –{" "}
            {formatMinutesLabel(day, taskDrop.startMin + 60)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wraps an event's grid block in a non-modal popover (base-ui Popover renders
 * no backdrop, so the rest of the calendar stays live and unblurred — the
 * Google-Calendar behaviour). The trigger IS the block; clicking it opens the
 * details beside it and lifts the block to the front. The pencil inside hands
 * off to the modal editor. Used for both timed blocks (caller passes absolute
 * `triggerStyle`) and the flow-laid all-day chips.
 */
function EventPopover({
  event,
  propertyId,
  currentUserId,
  onEditEvent,
  onMutated,
  triggerClassName,
  triggerStyle,
  children,
}: {
  event: CalendarEvent;
  propertyId: string;
  currentUserId: string;
  onEditEvent: (event: CalendarEvent) => void;
  onMutated?: () => void;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-event-block
        className={cn(triggerClassName, open && "ring-2 ring-foreground/40")}
        // Open lifts the block clear of its shingled neighbours.
        style={open ? { ...triggerStyle, zIndex: 40 } : triggerStyle}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-3.5"
      >
        <EventDetailBody
          event={event}
          propertyId={propertyId}
          currentUserId={currentUserId}
          onEdit={() => {
            setOpen(false);
            onEditEvent(event);
          }}
          onClose={() => setOpen(false)}
          onMutated={onMutated}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A single timed block, shingled into its overlap group. Earlier events sit
 * lower in the z-stack; each block widens past its lane (`SHINGLE_SPREAD`) to
 * peek out from under the next, and the clicked one lifts to the front — no
 * wasted gaps, every block reachable.
 */
function PositionedEvent({
  day,
  event,
  column,
  columns,
  propertyId,
  currentUserId,
  onEditEvent,
  onMutated,
}: {
  day: Date;
  event: CalendarEvent;
  column: number;
  columns: number;
  propertyId: string;
  currentUserId: string;
  onEditEvent: (event: CalendarEvent) => void;
  onMutated?: () => void;
}) {
  const { top, height } = clampTopHeight(
    new Date(event.start),
    new Date(event.end),
    day,
  );
  const step = 100 / columns;
  const leftPct = column * step;
  // Widen past the lane to overlap the neighbour, but never past the column edge.
  const widthPct = Math.min(step * SHINGLE_SPREAD, 100 - leftPct);
  return (
    <EventPopover
      event={event}
      propertyId={propertyId}
      currentUserId={currentUserId}
      onEditEvent={onEditEvent}
      onMutated={onMutated}
      triggerClassName={cn(
        "absolute overflow-hidden rounded-md border-l-2 py-1 pr-1.5 pl-2 text-left text-xs shadow-xs ring-1 ring-inset transition-shadow hover:shadow-md dark:shadow-none dark:hover:shadow-none",
        eventTint(event),
      )}
      triggerStyle={{
        top,
        height,
        left: `calc(${leftPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
        zIndex: column + 1,
        // An explicit event colour overrides the source tint, including
        // the accent edge — the tint classes only carry the fallback.
        ...(event.color
          ? {
              borderLeftColor: `#${event.color}`,
              backgroundColor: `#${event.color}1A`,
            }
          : undefined),
      }}
    >
      <EventBlock event={event} />
    </EventPopover>
  );
}

/**
 * The collapsed stand-in for a slot too dense to shingle. Instead of a row of
 * unreadable slivers, the pile renders as ONE tile spanning its time range,
 * labelled with the event count; clicking opens a non-modal popover that lists
 * every event and drills into any one's details in place (no blur, no modal).
 */
function ClusterTile({
  day,
  start,
  end,
  count,
  events,
  propertyId,
  currentUserId,
  onEditEvent,
  onMutated,
}: {
  day: Date;
  start: Date;
  end: Date;
  count: number;
  events: CalendarEvent[];
  propertyId: string;
  currentUserId: string;
  onEditEvent: (event: CalendarEvent) => void;
  onMutated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { top, height } = clampTopHeight(start, end, day);
  const compact = height < 44;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-event-block
        className={cn(
          "absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-border/70 bg-card text-center text-foreground shadow-sm ring-1 ring-inset ring-border transition-colors hover:border-foreground/30 hover:bg-accent",
          open && "ring-2 ring-foreground/40",
        )}
        style={{
          top,
          height,
          left: "1px",
          width: "calc(100% - 2px)",
          zIndex: open ? 40 : 6,
        }}
      >
        <span className="flex items-center gap-1 text-xs font-semibold leading-none">
          <Layers className="size-3 opacity-70" />
          {count}
        </span>
        {!compact ? (
          <span className="text-xs font-medium uppercase tracking-wide leading-none text-muted-foreground">
            events
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2"
      >
        <ClusterCard
          events={events}
          start={start}
          end={end}
          propertyId={propertyId}
          currentUserId={currentUserId}
          onEditEvent={onEditEvent}
          onMutated={onMutated}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Top/height in px for a [start,end) range, clamped to `day`'s bounds. */
function clampTopHeight(start: Date, end: Date, day: Date) {
  const dayStart = startOfDay(day);
  const dayEnd = addMinutes(dayStart, MINUTES_PER_DAY);
  const visibleStart = start < dayStart ? dayStart : start;
  const visibleEnd = end > dayEnd ? dayEnd : end;
  const top = (minutesFromMidnight(visibleStart) / 60) * HOUR_HEIGHT_PX;
  const height = Math.max(
    16,
    ((visibleEnd.getTime() - visibleStart.getTime()) / 60_000 / 60) *
      HOUR_HEIGHT_PX,
  );
  return { top, height };
}

/**
 * The two-pane body inside a {@link ClusterTile} popover: a scrollable list of
 * the slot's events, and — once one is picked — that event's full details with
 * a back link. Everything stays in the same non-modal popover.
 */
function ClusterCard({
  events,
  start,
  end,
  propertyId,
  currentUserId,
  onEditEvent,
  onMutated,
  onClose,
}: {
  events: CalendarEvent[];
  start: Date;
  end: Date;
  propertyId: string;
  currentUserId: string;
  onEditEvent: (event: CalendarEvent) => void;
  onMutated?: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  return (
    <>
      {/* The list stays mounted (just hidden) while a detail is open, so the
          clicked row isn't detached mid-click — detaching it makes base-ui's
          outside-press detector read the click as "outside" and dismiss the
          popover (the click then appears to fall through to the grid). */}
      <div className={cn("flex flex-col gap-1", selected && "hidden")}>
        <div className="flex items-baseline justify-between px-1.5 pt-1 pb-1">
          <span className="text-sm font-medium">{events.length} events</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatTimeRange(start, end)}
          </span>
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {sorted.map((ev) => (
            <button
              key={`${ev.source}:${ev.id}`}
              type="button"
              onClick={() => setSelected(ev)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  !ev.color && eventDotClass(ev),
                )}
                style={
                  ev.color ? { backgroundColor: `#${ev.color}` } : undefined
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {ev.title}
                </span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {formatTimeRange(new Date(ev.start), new Date(ev.end))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            All {events.length} events
          </button>
          <div className="px-1.5 pb-1">
            <EventDetailBody
              event={selected}
              propertyId={propertyId}
              currentUserId={currentUserId}
              onEdit={() => {
                onClose();
                onEditEvent(selected);
              }}
              onClose={onClose}
              onMutated={onMutated}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function FreeBusyLanes({
  day,
  slots,
  lanes,
  userColors,
}: {
  day: Date;
  slots: FreeBusySlot[];
  lanes: string[];
  userColors: Map<string, string>;
}) {
  const dayStart = startOfDay(day);
  const dayEnd = addMinutes(dayStart, MINUTES_PER_DAY);
  const laneWidthPx = 6;
  const laneGapPx = 2;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 flex"
      style={{ width: lanes.length * (laneWidthPx + laneGapPx) }}
    >
      {lanes.map((userId) => {
        const color = userColors.get(userId) ?? "94a3b8";
        const userSlots = slots.filter((s) => s.user_id === userId);
        return (
          <div
            key={userId}
            className="relative h-full"
            style={{
              width: laneWidthPx,
              marginLeft: laneGapPx,
              backgroundColor: `#${color}10`,
            }}
          >
            {userSlots.map((slot, idx) => {
              const slotStart = new Date(slot.start_at);
              const slotEnd = new Date(slot.end_at);
              const visStart =
                slotStart < dayStart ? dayStart : slotStart;
              const visEnd = slotEnd > dayEnd ? dayEnd : slotEnd;
              const top =
                (minutesFromMidnight(visStart) / 60) * HOUR_HEIGHT_PX;
              const height = Math.max(
                3,
                ((visEnd.getTime() - visStart.getTime()) /
                  60_000 /
                  60) *
                  HOUR_HEIGHT_PX,
              );
              const opacity = slot.busy === "tentative" ? 0.45 : 0.75;
              return (
                <div
                  key={`${slot.start_at}-${idx}`}
                  className="absolute inset-x-0 rounded-sm"
                  style={{
                    top,
                    height,
                    backgroundColor: `#${color}`,
                    opacity,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
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
        className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-rose-500"
        style={{ top }}
      />
      <div
        className="pointer-events-none absolute z-10 size-2.5 -translate-y-1/2 rounded-full bg-rose-500 ring-2 ring-background"
        style={{ top, left: -5 }}
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

/** Localized "6:00 – 7:30 PM"-style range, shared by the overflow popover. */
function formatTimeRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleTimeString(undefined, opts)} – ${end.toLocaleTimeString(undefined, opts)}`;
}

/** Localized "9:15 AM"-style label for minutes-from-midnight on `day`. */
function formatMinutesLabel(day: Date, minutes: number): string {
  return addMinutes(startOfDay(day), minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whether `d` falls on a Saturday or Sunday. */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

