"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, Diamond } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { COLUMNS, COLUMN_PILL_CLASS, STATUS_IDS, type Task } from "./kanban";
import { StatusIcon } from "./task-icons";
import { rescheduleTask } from "./actions";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { taskDependenciesQueryOptions } from "@/lib/query/task-dependency-queries";
import {
  projectMilestonesQueryOptions,
  propertyMilestonesQueryOptions,
} from "@/lib/query/milestone-queries";
import { useMilestonesRealtime } from "@/components/projects/milestones-panel";

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** Days-per-pixel zoom levels — gr8r's Weeks (32px/day) and Months (11px/day). */
const ZOOM = {
  weeks: { dayWidth: 32, label: "Weeks" },
  months: { dayWidth: 11, label: "Months" },
} as const;
type Zoom = keyof typeof ZOOM;

type GroupBy = "status" | "assignee" | "none";

const ROW_HEIGHT = 34; // px per task lane — the house data-row rhythm
const BAR_HEIGHT = 22;
const LABEL_WIDTH = 288; // left pane
/** 32px is `h-8` — the list view's status group header, so the views share one band. */
const GROUP_HEIGHT = 32;
const HINT_HEIGHT = 30;
const AXIS_MONTH_HEIGHT = 22;
const AXIS_DAY_HEIGHT = 26;
const AXIS_HEIGHT = AXIS_MONTH_HEIGHT + AXIS_DAY_HEIGHT;
const MS_PER_DAY = 86_400_000;
/** Title fits inside the bar once it's this wide; narrower bars label to the right. */
const INSIDE_LABEL_MIN = 110;

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
/** Monday of the week containing `d`. */
function startOfWeek(d: Date) {
  const out = startOfDay(d);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}
function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function diffDays(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY);
}
function parseDateOnly(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}
function fmtShort(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A task's span in whole-day offsets from the window start. A scheduled
 * window spans its days; a due-only task is a one-day bar on its due date
 * (gr8r's convention — every dated task is a draggable bar, so the diamond
 * glyph is free to mean "milestone" and nothing else).
 */
type Span = { startDay: number; endDay: number; kind: "range" | "due" };

function spanOf(task: Task, windowStart: Date): Span | null {
  if (task.scheduled_start) {
    const start = diffDays(new Date(task.scheduled_start), windowStart);
    // A block ending at exactly midnight belongs to the previous day.
    const endMs = task.scheduled_end
      ? new Date(task.scheduled_end).getTime() - 1
      : new Date(task.scheduled_start).getTime();
    const end = Math.max(start, diffDays(new Date(endMs), windowStart));
    return { startDay: start, endDay: end, kind: "range" };
  }
  if (task.due_at) {
    const day = diffDays(new Date(task.due_at), windowStart);
    return { startDay: day, endDay: day, kind: "due" };
  }
  return null;
}

type Group = {
  key: string;
  label: string;
  tone: keyof typeof COLUMN_PILL_CLASS;
  icon: React.ReactNode;
  tasks: Task[];
};

type Row =
  | { type: "milestones"; y: number; h: number }
  | { type: "group"; y: number; h: number; group: Group }
  | { type: "task"; y: number; h: number; task: Task; span: Span; group: Group }
  | { type: "hint"; y: number; h: number; text: string };

export type TimelineMilestone = {
  id: string;
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  done: boolean;
  /** Project name for cross-project lanes; null inside one project. */
  project: string | null;
};

type Props = {
  propertyId: string;
  tasks: Task[];
  assignees: Record<string, AssigneeInfo>;
  hideDone: boolean;
  /** Where the milestone lane reads from. Omit to hide the lane. */
  milestoneScope?: { kind: "property" } | { kind: "project"; id: string };
  defaultGroup?: GroupBy;
  /** Called after a drag persisted, so hosts can refresh their own caches. */
  onChanged?: () => void;
  className?: string;
};

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Gantt timeline — the gr8r model ported onto our data: a wide scrollable
 * canvas (not a fixed 4-week window), Weeks/Months zoom, group by status or
 * assignee, every dated task a draggable bar (drag moves it by whole days,
 * the right edge resizes a scheduled window), sub-issue progress filled into
 * the bar, `blocks` relations drawn as dependency arrows (dashed when the
 * blocked task starts before its blocker ends), and a milestone lane on top.
 * One scroll container: the left label pane is sticky so vertical scroll
 * stays in lockstep, and the axis is sticky-top.
 */
export function TimelineView({
  propertyId,
  tasks,
  assignees,
  hideDone,
  milestoneScope,
  defaultGroup = "status",
  onChanged,
  className,
}: Props) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const [groupBy, setGroupBy] = useState<GroupBy>(defaultGroup);
  const dayWidth = ZOOM[zoom].dayWidth;

  const { data: deps = [] } = useQuery(taskDependenciesQueryOptions(propertyId));

  // Milestones — property-wide or one project.
  const projectScopeId = milestoneScope?.kind === "project" ? milestoneScope.id : "";
  useMilestonesRealtime(projectScopeId);
  const { data: projectMs = [] } = useQuery({
    ...projectMilestonesQueryOptions(projectScopeId),
    enabled: milestoneScope?.kind === "project",
  });
  const { data: propertyMs = [] } = useQuery({
    ...propertyMilestonesQueryOptions(propertyId),
    enabled: milestoneScope?.kind === "property",
  });
  const milestones = useMemo<TimelineMilestone[]>(() => {
    if (!milestoneScope) return [];
    if (milestoneScope.kind === "project")
      return projectMs.map((m) => ({
        id: m.id,
        name: m.name,
        date: m.due_date,
        done: Boolean(m.completed_at),
        project: null,
      }));
    return propertyMs.map((m) => ({
      id: m.id,
      name: m.name,
      date: m.due_date,
      done: Boolean(m.completed_at),
      project: m.project?.name ?? null,
    }));
  }, [milestoneScope, projectMs, propertyMs]);

  const visible = useMemo(
    () => (hideDone ? tasks.filter((t) => t.status !== "done") : tasks),
    [tasks, hideDone],
  );

  // Sub-issue progress: children present in the board's task set.
  const progress = useMemo(() => {
    const total = new Map<string, number>();
    const done = new Map<string, number>();
    for (const t of tasks) {
      if (!t.parent_id) continue;
      total.set(t.parent_id, (total.get(t.parent_id) ?? 0) + 1);
      if (t.status === "done") done.set(t.parent_id, (done.get(t.parent_id) ?? 0) + 1);
    }
    return { total, done };
  }, [tasks]);

  /* ── Window: today-centred, widened to cover every dated task ───────────── */
  const today = startOfDay(new Date());
  const todayKey = today.getTime();
  const { windowStart, nDays } = useMemo(() => {
    const back = zoom === "weeks" ? 21 : 56;
    const span = zoom === "weeks" ? 7 * 13 : 7 * 34;
    let start = startOfWeek(addDays(today, -back));
    let end = addDays(start, span - 1);
    for (const t of visible) {
      const a = t.scheduled_start ? new Date(t.scheduled_start) : t.due_at ? new Date(t.due_at) : null;
      const b = t.scheduled_end ? new Date(t.scheduled_end) : a;
      if (a && a < start) start = startOfWeek(addDays(a, -7));
      if (b && b > end) end = addDays(b, 14);
    }
    for (const m of milestones) {
      const d = parseDateOnly(m.date);
      if (d < start) start = startOfWeek(addDays(d, -7));
      if (d > end) end = addDays(d, 14);
    }
    // Cap at ~2 years so one stray 2099 date can't make a 30k-px canvas.
    const n = Math.min(Math.max(diffDays(end, start) + 1, span), 730);
    return { windowStart: start, nDays: Math.ceil(n / 7) * 7 };
    // `today` is derived each render; `todayKey` is its stable day value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, milestones, zoom, todayKey]);
  const todayOffset = diffDays(today, windowStart);
  const canvasWidth = nDays * dayWidth;

  /* ── Groups ─────────────────────────────────────────────────────────────── */
  const groups = useMemo<Group[]>(() => {
    if (groupBy === "status") {
      return STATUS_IDS.filter((s) => !(hideDone && s === "done")).map((s) => {
        const col = COLUMNS.find((c) => c.id === s)!;
        return {
          key: s,
          label: col.label,
          tone: col.pillTone,
          icon: <StatusIcon status={s} className="size-3.5" />,
          tasks: visible.filter((t) => t.status === s),
        };
      });
    }
    if (groupBy === "assignee") {
      const byId = new Map<string, Task[]>();
      const none: Task[] = [];
      for (const t of visible) {
        if (!t.assignee_id) none.push(t);
        else byId.set(t.assignee_id, [...(byId.get(t.assignee_id) ?? []), t]);
      }
      const out: Group[] = [...byId.entries()]
        .map(([id, ts]) => ({
          key: id,
          label: assignees[id]?.name ?? "Member",
          tone: "neutral" as const,
          icon: <PersonAvatar info={assignees[id]} />,
          tasks: ts,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (none.length)
        out.push({
          key: "none",
          label: "Unassigned",
          tone: "neutral",
          icon: <PersonAvatar />,
          tasks: none,
        });
      return out;
    }
    return [{ key: "all", label: "All tasks", tone: "neutral", icon: null, tasks: visible }];
  }, [groupBy, visible, hideDone, assignees]);

  /* ── Rows (shared by both panes) ────────────────────────────────────────── */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let y = 0;
    type RowInput = Row extends infer R ? (R extends Row ? Omit<R, "y"> : never) : never;
    const push = (r: RowInput) => {
      out.push({ ...r, y } as Row);
      y += r.h;
    };
    if (milestones.length) push({ type: "milestones", h: ROW_HEIGHT });
    for (const g of groups) {
      if (groupBy !== "none") push({ type: "group", h: GROUP_HEIGHT, group: g });
      const dated = g.tasks
        .map((t) => ({ t, span: spanOf(t, windowStart) }))
        .filter((x): x is { t: Task; span: Span } => x.span !== null)
        .sort((a, b) => a.span.startDay - b.span.startDay || a.span.endDay - b.span.endDay);
      const undated = g.tasks.length - dated.length;
      for (const { t, span } of dated) push({ type: "task", h: ROW_HEIGHT, task: t, span, group: g });
      if (dated.length === 0 && undated === 0)
        push({ type: "hint", h: HINT_HEIGHT, text: "Nothing here" });
      if (undated > 0)
        push({ type: "hint", h: HINT_HEIGHT, text: `No date — ${undated}` });
    }
    return out;
  }, [groups, groupBy, milestones.length, windowStart]);
  const bodyHeight = rows.reduce((acc, r) => acc + r.h, 0);

  const rowCenterByTask = useMemo(() => {
    const m = new Map<string, { y: number; span: Span }>();
    for (const r of rows)
      if (r.type === "task") m.set(r.task.id, { y: r.y + r.h / 2, span: r.span });
    return m;
  }, [rows]);

  /* ── Drag (move / resize) ───────────────────────────────────────────────── */
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "resize";
    deltaDays: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const persistShift = useCallback(
    async (task: Task, span: Span, mode: "move" | "resize", deltaDays: number) => {
      if (deltaDays === 0) return;
      const shift = (iso: string) => new Date(new Date(iso).getTime() + deltaDays * MS_PER_DAY).toISOString();
      let patch: Parameters<typeof rescheduleTask>[0];
      let optimistic: Partial<Task>;
      if (mode === "resize") {
        // Only ranges resize. Clamp so the window never inverts.
        const start = new Date(task.scheduled_start!);
        const end = new Date(task.scheduled_end ?? task.scheduled_start!);
        const next = new Date(end.getTime() + deltaDays * MS_PER_DAY);
        if (next <= start) return;
        patch = { taskId: task.id, scheduledEnd: next.toISOString() };
        optimistic = { scheduled_end: next.toISOString() };
      } else if (span.kind === "range") {
        patch = {
          taskId: task.id,
          scheduledStart: shift(task.scheduled_start!),
          scheduledEnd: task.scheduled_end ? shift(task.scheduled_end) : undefined,
          // Keep the due date travelling with the block when both exist.
          dueAt: task.due_at ? shift(task.due_at) : undefined,
        };
        optimistic = {
          scheduled_start: patch.scheduledStart,
          scheduled_end: patch.scheduledEnd ?? task.scheduled_end,
          due_at: patch.dueAt ?? task.due_at,
        };
      } else {
        patch = { taskId: task.id, dueAt: shift(task.due_at!) };
        optimistic = { due_at: patch.dueAt };
      }
      qc.setQueryData<Task[]>(["tasks", propertyId], (prev) =>
        (prev ?? []).map((t) => (t.id === task.id ? { ...t, ...optimistic } : t)),
      );
      const res = await rescheduleTask(patch);
      if ("error" in res) toast.error(res.error);
      else {
        const n = Math.abs(deltaDays);
        toast.success(
          mode === "resize"
            ? `${deltaDays > 0 ? "Extended" : "Shortened"} “${task.title}” by ${n} day${n > 1 ? "s" : ""}`
            : `Moved “${task.title}” ${n} day${n > 1 ? "s" : ""} ${deltaDays > 0 ? "later" : "earlier"}`,
          { duration: 2200 },
        );
      }
      void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
      onChanged?.();
    },
    [qc, propertyId, onChanged],
  );

  function startDrag(
    e: React.PointerEvent,
    task: Task,
    span: Span,
    mode: "move" | "resize",
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let moved = false;
    let delta = 0;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) moved = true;
      if (!moved) return;
      const next = Math.round(dx / dayWidth);
      if (next !== delta) {
        delta = next;
        setDrag({ id: task.id, mode, deltaDays: delta });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 80);
      void persistShift(task, span, mode, delta);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /* ── Scroll to today on mount + zoom change ─────────────────────────────── */
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayX = todayOffset * dayWidth;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayX - 160);
    // Re-centre only when the zoom changes, not on every data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  const jumpToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: Math.max(0, todayX - 160), behavior: "smooth" });
  };

  /* ── Axis ───────────────────────────────────────────────────────────────── */
  const months = useMemo(() => {
    const out: { label: string; startDay: number; days: number }[] = [];
    for (let i = 0; i < nDays; i++) {
      const d = addDays(windowStart, i);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const last = out[out.length - 1];
      if (last && (last as { key?: string }).key === key) last.days++;
      else
        out.push(
          Object.assign(
            {
              label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
              startDay: i,
              days: 1,
            },
            { key },
          ),
        );
    }
    return out;
  }, [windowStart, nDays]);

  const weekCount = nDays / 7;
  const anyDated = rows.some((r) => r.type === "task");

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      {/* Toolbar — 36px, matching the board toolbar above it. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <ToggleGroup
          value={[zoom]}
          onValueChange={(v) => {
            const next = (v as Zoom[])[0];
            if (next) setZoom(next);
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Zoom"
        >
          {(Object.keys(ZOOM) as Zoom[]).map((z) => (
            <ToggleGroupItem key={z} value={z}>
              {ZOOM[z].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <NativeSelect
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          aria-label="Group by"
          className="h-7 w-auto text-sm"
        >
          <option value="status">Group: Status</option>
          <option value="assignee">Group: Assignee</option>
          <option value="none">No grouping</option>
        </NativeSelect>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={jumpToToday}>
          <Crosshair className="size-3.5" />
          Today
        </Button>
        <div className="ml-auto hidden items-center gap-3 text-xs text-faint-foreground lg:flex">
          <span className="inline-flex items-center gap-1.5">
            <span className="block h-1.5 w-4 rounded-full bg-pill-info" />
            Drag to move · edge to resize
          </span>
          {milestones.length ? (
            <span className="inline-flex items-center gap-1.5">
              <Diamond className="size-3 fill-foreground text-foreground" />
              Milestone
            </span>
          ) : null}
          {deps.length ? (
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden="true">
                <path d="M0 4 H14 M10 1 L14 4 L10 7" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              Blocks
            </span>
          ) : null}
        </div>
      </div>

      {/* Body — one scroll container; left pane sticky-left, axis sticky-top. */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 overflow-auto">
        {/* Left labels */}
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-card"
          style={{ width: LABEL_WIDTH }}
        >
          <div
            className="sticky top-0 z-10 flex items-end border-b border-border bg-card px-3 pb-1.5 text-xs font-medium text-faint-foreground"
            style={{ height: AXIS_HEIGHT }}
          >
            Task
          </div>
          <div className="relative" style={{ height: bodyHeight }}>
            {rows.map((r, i) => {
              if (r.type === "milestones")
                return (
                  <div
                    key="ms"
                    className="absolute inset-x-0 flex items-center gap-2 border-b border-border bg-muted/60 px-3 text-xs font-medium text-muted-foreground"
                    style={{ top: r.y, height: r.h }}
                  >
                    <Diamond className="size-3" />
                    Milestones
                    <span className="ml-auto tabular-nums text-faint-foreground">{milestones.length}</span>
                  </div>
                );
              if (r.type === "group")
                return (
                  <header
                    key={`g-${r.group.key}`}
                    className="absolute inset-x-0 flex items-center gap-2 border-b border-border bg-muted px-3"
                    style={{ top: r.y, height: r.h }}
                  >
                    {r.group.icon}
                    <h3 className="truncate text-sm font-medium text-foreground">{r.group.label}</h3>
                    <span className="ml-auto text-xs tabular-nums text-faint-foreground">
                      {r.group.tasks.length}
                    </span>
                  </header>
                );
              if (r.type === "hint")
                return (
                  <div
                    key={`h-${i}`}
                    className="absolute inset-x-0 flex items-center border-b border-border px-3 text-xs text-faint-foreground"
                    style={{ top: r.y, height: r.h }}
                  >
                    {r.text}
                  </div>
                );
              const sub = progress.total.get(r.task.id);
              return (
                <button
                  key={r.task.id}
                  type="button"
                  onClick={() => openTask(r.task.id)}
                  className="absolute inset-x-0 flex items-center gap-2 border-b border-border px-3 text-left transition-colors hover:bg-accent"
                  style={{ top: r.y, height: r.h }}
                >
                  <StatusIcon status={r.task.status} className="size-3.5 shrink-0" />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      r.task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {r.task.title}
                  </span>
                  {sub ? (
                    <span className="shrink-0 text-xs tabular-nums text-faint-foreground">
                      {progress.done.get(r.task.id) ?? 0}/{sub}
                    </span>
                  ) : null}
                  {r.task.assignee_id ? (
                    <PersonAvatar info={assignees[r.task.assignee_id]} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right canvas */}
        <div className="relative shrink-0" style={{ width: canvasWidth }}>
          {/* Axis */}
          <div
            className="sticky top-0 z-10 border-b border-border bg-card"
            style={{ height: AXIS_HEIGHT, width: canvasWidth }}
          >
            <div className="relative flex" style={{ height: AXIS_MONTH_HEIGHT }}>
              {months.map((m) => (
                <div
                  key={`${m.label}-${m.startDay}`}
                  className="flex items-center overflow-hidden border-l border-border text-xs font-medium text-foreground"
                  style={{ width: m.days * dayWidth }}
                >
                  {/* Month name sticks to the left while its month scrolls out. */}
                  <span className="sticky left-[calc(var(--label-w)+8px)] truncate px-2" style={{ "--label-w": `${LABEL_WIDTH}px` } as React.CSSProperties}>
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="relative flex border-t border-border" style={{ height: AXIS_DAY_HEIGHT }}>
              {zoom === "weeks"
                ? Array.from({ length: nDays }, (_, i) => {
                    const d = addDays(windowStart, i);
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    const isToday = i === todayOffset;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center justify-center text-[11px] tabular-nums",
                          d.getDay() === 1 ? "border-l border-border" : "border-l border-border/40",
                          isToday
                            ? "font-semibold text-primary"
                            : weekend
                              ? "text-faint-foreground/70"
                              : "text-faint-foreground",
                        )}
                        style={{ width: dayWidth }}
                        title={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                      >
                        {d.getDate()}
                      </div>
                    );
                  })
                : Array.from({ length: weekCount }, (_, i) => {
                    const d = addDays(windowStart, i * 7);
                    const holdsToday = todayOffset >= i * 7 && todayOffset < i * 7 + 7;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex items-center border-l border-border pl-1 text-[11px] tabular-nums",
                          holdsToday ? "font-semibold text-primary" : "text-faint-foreground",
                        )}
                        style={{ width: dayWidth * 7 }}
                      >
                        {fmtShort(d)}
                      </div>
                    );
                  })}
            </div>
          </div>

          {/* Grid */}
          <div className="relative" style={{ height: bodyHeight, width: canvasWidth }}>
            {/* Weekend wash (weeks zoom only — at 11px/day it reads as noise) */}
            {zoom === "weeks"
              ? Array.from({ length: nDays }, (_, i) => {
                  const d = addDays(windowStart, i);
                  return d.getDay() === 0 || d.getDay() === 6 ? (
                    <div
                      key={`we-${i}`}
                      className="absolute inset-y-0 bg-muted/50"
                      style={{ left: i * dayWidth, width: dayWidth }}
                      aria-hidden="true"
                    />
                  ) : null;
                })
              : null}
            {/* Week lines */}
            {Array.from({ length: weekCount + 1 }, (_, i) => (
              <div
                key={`wl-${i}`}
                className="absolute inset-y-0 w-px bg-border/70"
                style={{ left: i * 7 * dayWidth }}
                aria-hidden="true"
              />
            ))}
            {/* Row backgrounds */}
            {rows.map((r, i) => (
              <div
                key={`rb-${i}`}
                className={cn(
                  "absolute inset-x-0 border-b border-border",
                  r.type === "group" && "bg-muted",
                  r.type === "milestones" && "bg-muted/60",
                )}
                style={{ top: r.y, height: r.h }}
                aria-hidden="true"
              />
            ))}
            {/* Today */}
            {todayOffset >= 0 && todayOffset < nDays ? (
              <div
                className="absolute inset-y-0 z-[2] w-0.5 bg-primary/70"
                style={{ left: todayX + dayWidth / 2 }}
                title="Today"
                aria-hidden="true"
              />
            ) : null}

            {/* Milestone lane */}
            {rows.map((r) =>
              r.type === "milestones" ? (
                <MilestoneLane
                  key="ms-lane"
                  milestones={milestones}
                  windowStart={windowStart}
                  dayWidth={dayWidth}
                  y={r.y}
                  h={r.h}
                />
              ) : null,
            )}

            {/* Bars */}
            {rows.map((r) => {
              if (r.type !== "task") return null;
              const dragging = drag?.id === r.task.id ? drag : null;
              const moveDelta = dragging?.mode === "move" ? dragging.deltaDays : 0;
              const resizeDelta = dragging?.mode === "resize" ? dragging.deltaDays : 0;
              const startDay = r.span.startDay + moveDelta;
              const endDay = Math.max(startDay, r.span.endDay + moveDelta + resizeDelta);
              const x = startDay * dayWidth;
              const w = Math.max(dayWidth, (endDay - startDay + 1) * dayWidth) - 2;
              const inside = w > INSIDE_LABEL_MIN;
              const total = progress.total.get(r.task.id) ?? 0;
              const pct =
                r.task.status === "done"
                  ? 100
                  : total > 0
                    ? Math.round(((progress.done.get(r.task.id) ?? 0) / total) * 100)
                    : 0;
              const pill = COLUMN_PILL_CLASS[r.group.tone === "neutral" && groupBy === "status" ? r.group.tone : (COLUMNS.find((c) => c.id === r.task.status)?.pillTone ?? "neutral")].pill;
              const startDate = addDays(windowStart, startDay);
              const endDate = addDays(windowStart, endDay);
              const tip = `${r.task.title} · ${fmtShort(startDate)}${endDay !== startDay ? ` → ${fmtShort(endDate)}` : ""}`;
              return (
                <div key={r.task.id} className="contents">
                  <div
                    role="button"
                    tabIndex={0}
                    title={tip}
                    aria-label={tip}
                    onPointerDown={(e) => startDrag(e, r.task, r.span, "move")}
                    onClick={() => {
                      if (!suppressClick.current) openTask(r.task.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTask(r.task.id);
                      }
                    }}
                    className={cn(
                      "absolute z-[3] flex items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs font-medium select-none",
                      pill,
                      dragging ? "cursor-grabbing shadow-overlay ring-1 ring-primary/40" : "cursor-grab hover:brightness-95",
                      r.task.status === "done" && "opacity-60",
                    )}
                    style={{
                      left: x + 1,
                      top: r.y + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                      width: w,
                      height: BAR_HEIGHT,
                    }}
                  >
                    {pct > 0 && pct < 100 ? (
                      <span
                        className="absolute inset-y-0 left-0 bg-foreground/10"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {inside ? (
                      <>
                        {r.task.assignee_id ? (
                          <PersonAvatar info={assignees[r.task.assignee_id]} size="xs" />
                        ) : null}
                        <span className="relative truncate">{r.task.title}</span>
                      </>
                    ) : null}
                    {r.span.kind === "range" ? (
                      <span
                        onPointerDown={(e) => startDrag(e, r.task, r.span, "resize")}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  {!inside ? (
                    <span
                      className="pointer-events-none absolute z-[3] truncate text-xs text-muted-foreground"
                      style={{ left: x + w + 8, top: r.y + (ROW_HEIGHT - 16) / 2, maxWidth: 240, lineHeight: "16px" }}
                    >
                      {r.task.title}
                    </span>
                  ) : null}
                </div>
              );
            })}

            {/* Dependency arrows */}
            <svg
              className="pointer-events-none absolute left-0 top-0 z-[2]"
              width={canvasWidth}
              height={bodyHeight}
              viewBox={`0 0 ${canvasWidth} ${bodyHeight}`}
              aria-hidden="true"
            >
              {deps.map((d) => {
                const a = rowCenterByTask.get(d.blocker);
                const b = rowCenterByTask.get(d.blocked);
                if (!a || !b) return null;
                const x1 = (a.span.endDay + 1) * dayWidth;
                const y1 = a.y;
                const x2 = b.span.startDay * dayWidth;
                const y2 = b.y;
                const conflict = x2 < x1;
                const c1 = Math.max(x1 + 12, x2 - 12);
                const c2 = Math.min(x1 + 12, x2 - 12);
                return (
                  <g
                    key={`${d.blocker}-${d.blocked}`}
                    className={conflict ? "text-warning" : "text-muted-foreground"}
                  >
                    <path
                      d={`M${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2 - 1} ${y2}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeDasharray={conflict ? "3 3" : undefined}
                    />
                    <path
                      d={`M${x2 - 6} ${y2 - 3.5} L${x2 - 1} ${y2} L${x2 - 6} ${y2 + 3.5}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                );
              })}
            </svg>

            {!anyDated && milestones.length === 0 ? (
              <div className="sticky left-0 flex w-[min(100%,36rem)] items-center px-6 py-10 text-sm text-muted-foreground">
                Nothing on the timeline yet — give tasks a due date or a scheduled window to see them here.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function PersonAvatar({ info, size = "sm" }: { info?: AssigneeInfo; size?: "xs" | "sm" }) {
  const cls = size === "xs" ? "size-4 text-[9px]" : "size-5 text-[10px]";
  return (
    <Avatar className={cn(cls, "shrink-0")} title={info?.name}>
      {info?.avatar ? <AvatarImage src={info.avatar} alt="" /> : null}
      <AvatarFallback className="bg-accent-pressed font-medium text-secondary-ink">
        {info ? initials(info.name) : "–"}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Milestone lane — one diamond per date (same-day milestones merge into one
 * with a "+N"), and each label may only use the room up to the next diamond;
 * cramped ones show just the diamond. The tooltip always carries everything.
 */
function MilestoneLane({
  milestones,
  windowStart,
  dayWidth,
  y,
  h,
}: {
  milestones: TimelineMilestone[];
  windowStart: Date;
  dayWidth: number;
  y: number;
  h: number;
}) {
  const byDate = new Map<string, TimelineMilestone[]>();
  for (const m of milestones) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const pts = [...byDate.entries()]
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, list]) => ({
      date,
      list,
      x: diffDays(parseDateOnly(date), windowStart) * dayWidth + dayWidth / 2,
    }));
  return (
    <>
      {pts.map((pt, i) => {
        const room = (pts[i + 1] ? pts[i + 1]!.x : Infinity) - pt.x - 24;
        const first = pt.list[0]!;
        const allDone = pt.list.every((m) => m.done);
        const name = first.name + (pt.list.length > 1 ? ` +${pt.list.length - 1}` : "");
        const tip =
          pt.list.map((m) => m.name + (m.project ? ` (${m.project})` : "")).join(" · ") +
          " · " +
          fmtShort(parseDateOnly(pt.date));
        return (
          <div
            key={pt.date}
            className="absolute z-[3] flex items-center gap-2"
            style={{ left: pt.x - 7, top: y + (h - 18) / 2, height: 18 }}
            title={tip}
            tabIndex={0}
            aria-label={`Milestone: ${tip}`}
          >
            <Diamond
              className={cn(
                "size-3.5 shrink-0",
                allDone ? "fill-success text-success" : "fill-foreground text-foreground",
              )}
            />
            {room >= 28 ? (
              <span
                className="truncate text-xs font-medium text-foreground"
                style={{ maxWidth: Number.isFinite(room) ? Math.round(room) : undefined }}
              >
                {name}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
