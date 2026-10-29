"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, ChartGantt, CircleCheck, Crosshair, Diamond, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ActiveFilterBar,
  EMPTY_FILTERS,
  FilterMenu,
  buildFieldValueIndex,
  matchesFacets,
  type BoardFilters,
  type FacetKey,
} from "@/components/tasks/board-filters";
import { PopoverRow, PopoverSection } from "@/components/tasks/board-toolbar";
import { useViewerId } from "@/components/activity/activity-log";
import {
  customFieldsQueryOptions,
  propertyTaskFieldValuesQueryOptions,
} from "@/lib/query/custom-field-queries";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { StIcon } from "@/components/gr8r/home-glyphs";
import { cVar, g8Color } from "@/components/gr8r/my-tasks-glyphs";
import { OvAv, OvPIcon, type OvMember } from "@/components/gr8r/overview-glyphs";
import { rescheduleTask } from "@/components/tasks/actions";
import { updateProject } from "@/components/projects/actions";
import { progressPct } from "@/components/projects/tracking/tracking-shared";
import type { Task } from "@/components/tasks/kanban";
import {
  propertyMembersQueryOptions,
  tasksQueryOptions,
  type PropertyMember,
} from "@/lib/query/section-queries";
import {
  projectsTrackingQueryOptions,
  type ProjectTracking,
} from "@/lib/query/project-queries";
import { propertyMilestonesQueryOptions } from "@/lib/query/milestone-queries";
import { taskDependenciesQueryOptions } from "@/lib/query/task-dependency-queries";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { useOpenProject } from "@/lib/projects/use-open-project";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import {
  isBlocked,
  isDone,
  isNotStarted,
  isStarted,
  type StatusLike,
} from "@/lib/tasks/statuses";

/**
 * gr8r-studio's workspace timeline (`pageWsTimeline` + `timelineHtml`,
 * src/views/timeline.js) over our data: every dated task across the
 * property on one Gantt, grouped by project by default, with gr8r's
 * Weeks (32px/day) / Months (11px/day) zoom, a milestone lane, `blocks`
 * dependency arrows and sub-issue progress fill.
 *
 * Behaviour is the board timeline's (components/tasks/timeline-view.tsx):
 * a scheduled window spans its days, a due-only task is a one-day bar on its
 * due date, drag moves by whole days (`rescheduleTask` — the due date
 * travels with a window), the right edge resizes a window. Ours on top of
 * gr8r: in project grouping each project's header row carries the project's
 * own start → target bar, draggable through `updateProject`.
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const IN_TIMELINE = /^\/p\/[^/]+\/timeline\/?$/;
const EMPTY_TASKS: Task[] = [];

/** Route entry: renders only while the surface pathname is `/timeline`. */
export function WsTimelinePage({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  if (!IN_TIMELINE.test(pathname)) return null;
  return <WsTimelineView propertyId={propertyId} />;
}

/* ── Geometry (gr8r's constants) ─────────────────────────────────────────── */

const ZOOM = { week: 32, month: 11 } as const;
type Zoom = keyof typeof ZOOM;
type GroupBy = "project" | "status" | "assignee" | "none";
const RH = 36;
const DAY = 86_400_000;

function startOfDay(d: Date) {
  const o = new Date(d);
  o.setHours(0, 0, 0, 0);
  return o;
}
function startOfWeek(d: Date) {
  const o = startOfDay(d);
  o.setDate(o.getDate() - ((o.getDay() + 6) % 7));
  return o;
}
function addDays(d: Date, n: number) {
  const o = new Date(d);
  o.setDate(o.getDate() + n);
  return o;
}
function diffDays(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
}
function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  if (!y) return null;
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function toDay(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function fmt(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A task's span in whole days from `ws`; null when undated. */
type Span = { s: number; e: number; kind: "range" | "due" };
function spanOf(t: Task, ws: Date): Span | null {
  if (t.scheduled_start) {
    const s = diffDays(new Date(t.scheduled_start), ws);
    const endMs = t.scheduled_end
      ? new Date(t.scheduled_end).getTime() - 1
      : new Date(t.scheduled_start).getTime();
    return { s, e: Math.max(s, diffDays(new Date(endMs), ws)), kind: "range" };
  }
  if (t.due_at) {
    const d = diffDays(new Date(t.due_at), ws);
    return { s: d, e: d, kind: "due" };
  }
  return null;
}
function projectSpan(p: ProjectTracking, ws: Date): { s: number; e: number } | null {
  const a = parseDay(p.start_date) ?? parseDay(p.target_date);
  const b = parseDay(p.target_date) ?? a;
  if (!a || !b) return null;
  const s = diffDays(a, ws);
  return { s, e: Math.max(s, diffDays(b, ws)) };
}

/** Task status colour — gr8r's `--st-*` over our category. */
function statusColor(t: StatusLike): string {
  if (isDone(t)) return "var(--g8-st-done)";
  if (isBlocked(t)) return "var(--g8-red)";
  if (isStarted(t)) return "var(--g8-st-progress)";
  return "var(--g8-st-todo)";
}

type Group = {
  key: string;
  name: string;
  glyph: ReactNode;
  tasks: Task[];
  project?: ProjectTracking;
};
type Row =
  | { type: "ms" }
  | { type: "g"; G: Group }
  | { type: "t"; t: Task; span: Span };

/** gr8r's "Sort:" over a Gantt — Start date is gr8r's own row order. */
type TlSort = "start" | "due" | "priority" | "title" | "status" | "created" | "manual";
const TL_SORTS: TlSort[] = ["start", "due", "priority", "title", "status", "created", "manual"];
const TL_SORT_LABEL: Record<TlSort, string> = {
  start: "Start date",
  due: "Due date",
  priority: "Priority",
  title: "Title",
  status: "Status",
  created: "Created",
  manual: "Manual",
};
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const STATUS_RANK = (t: Task) => (isBlocked(t) ? 0 : isStarted(t) ? 1 : isDone(t) ? 3 : 2);
type SortRow = { t: Task; span: Span };
function compareRows(sort: TlSort, a: SortRow, b: SortRow): number {
  const bySpan = a.span.s - b.span.s || a.span.e - b.span.e;
  switch (sort) {
    case "due":
      return a.span.e - b.span.e || bySpan;
    case "priority":
      return (PRIORITY_RANK[a.t.priority] ?? 9) - (PRIORITY_RANK[b.t.priority] ?? 9) || bySpan;
    case "title":
      return a.t.title.localeCompare(b.t.title);
    case "status":
      return STATUS_RANK(a.t) - STATUS_RANK(b.t) || bySpan;
    case "created":
      return (a.t.created_at ?? "").localeCompare(b.t.created_at ?? "");
    case "manual":
      return (a.t.position ?? 0) - (b.t.position ?? 0);
    default:
      return bySpan;
  }
}

type Drag = { kind: "task" | "project"; id: string; mode: "move" | "resize"; delta: number };

export function WsTimelineView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const openTask = useOpenTask(propertyId);
  const openProject = useOpenProject(propertyId);
  const [zoom, setZoom] = useState<Zoom>("week");
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [hideDone, setHideDone] = useState(false);
  // gr8r's view toolbar: search + Filter (the board's facet menu + chips —
  // assignee, status, priority, team, project, label, cycle, due, custom
  // fields…) + Sort, over the same matcher the Tasks board uses.
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [addedFacet, setAddedFacet] = useState<FacetKey | null>(null);
  const [sort, setSort] = useState<TlSort>("start");
  const viewerId = useViewerId();
  const { data: customFields = [] } = useQuery(customFieldsQueryOptions(propertyId));
  const hasFieldFilter = Object.values(filters.fieldValues).some((v) => v.length > 0);
  const { data: fieldValueRows } = useQuery({
    ...propertyTaskFieldValuesQueryOptions(propertyId),
    enabled: hasFieldFilter,
  });
  const fieldIndex = useMemo(
    () => (fieldValueRows ? buildFieldValueIndex(fieldValueRows) : undefined),
    [fieldValueRows],
  );
  const [now] = useState(() => Date.now());
  const dw = ZOOM[zoom];

  const { data: allTasks = EMPTY_TASKS } = useQuery(tasksQueryOptions(propertyId));
  const { data: projects = [] } = useQuery(projectsTrackingQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: milestonesRaw = [] } = useQuery(propertyMilestonesQueryOptions(propertyId));
  const { data: deps = [] } = useQuery(taskDependenciesQueryOptions(propertyId));

  const memberById = useMemo(
    () => new Map<string, PropertyMember>(members.map((m) => [m.id, m])),
    [members],
  );
  const toAv = (id: string | null | undefined): OvMember | null => {
    if (!id) return null;
    const m = memberById.get(id);
    return m ? { id: m.id, name: m.name, avatarUrl: m.avatarUrl } : null;
  };
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Sub-issue progress over the full set.
  const progress = useMemo(() => {
    const total = new Map<string, number>();
    const done = new Map<string, number>();
    for (const t of allTasks) {
      if (!t.parent_id) continue;
      total.set(t.parent_id, (total.get(t.parent_id) ?? 0) + 1);
      if (isDone(t)) done.set(t.parent_id, (done.get(t.parent_id) ?? 0) + 1);
    }
    return { total, done };
  }, [allTasks]);

  const tasks = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return allTasks.filter(
      (t) =>
        (t.due_at || t.scheduled_start) &&
        !(hideDone && isDone(t)) &&
        (!term || t.title.toLowerCase().includes(term)) &&
        matchesFacets(t, filters, now, fieldIndex),
    );
  }, [allTasks, filters, hideDone, now, fieldIndex]);
  const visibleProjects = useMemo(
    () => projects.filter((p) => !(hideDone && p.status === "completed")),
    [projects, hideDone],
  );
  const milestones = useMemo(
    () => milestonesRaw.filter((m) => !(hideDone && m.completed_at)),
    [milestonesRaw, hideDone],
  );

  /* ── Window: gr8r's today-anchored range, widened to cover everything ── */
  const [today] = useState(() => startOfDay(new Date()));
  const { ws, nDays } = useMemo(() => {
    const span = zoom === "week" ? 7 * 13 : 7 * 34;
    let start = startOfWeek(addDays(today, zoom === "week" ? -21 : -56));
    let end = addDays(start, span - 1);
    const widen = (a: Date | null, b: Date | null) => {
      if (a && a < start) start = startOfWeek(addDays(a, -7));
      if (b && b > end) end = addDays(b, 14);
    };
    for (const t of tasks) {
      const a = t.scheduled_start ? new Date(t.scheduled_start) : t.due_at ? new Date(t.due_at) : null;
      widen(a, t.scheduled_end ? new Date(t.scheduled_end) : a);
    }
    if (groupBy === "project")
      for (const p of visibleProjects) widen(parseDay(p.start_date), parseDay(p.target_date));
    for (const m of milestones) {
      const d = parseDay(m.due_date);
      widen(d, d);
    }
    const n = Math.min(Math.max(diffDays(end, start) + 1, span), 730);
    return { ws: start, nDays: Math.ceil(n / 7) * 7 };
  }, [tasks, visibleProjects, milestones, zoom, groupBy, today]);
  const W = nDays * dw;
  const X = (d: Date) => diffDays(d, ws) * dw;

  /* ── Groups ── */
  const groups = useMemo<Group[]>(() => {
    if (groupBy === "project") {
      const by = new Map<string, Task[]>();
      const none: Task[] = [];
      for (const t of tasks) {
        if (t.project_id && projectById.has(t.project_id))
          by.set(t.project_id, [...(by.get(t.project_id) ?? []), t]);
        else none.push(t);
      }
      const out: Group[] = visibleProjects
        .filter((p) => by.has(p.id) || p.start_date || p.target_date)
        .map((p) => ({
          key: p.id,
          name: p.name,
          glyph: <OvPIcon color={p.color} icon={p.icon} size={18} />,
          tasks: by.get(p.id) ?? [],
          project: p,
        }));
      if (none.length) out.push({ key: "none", name: "No project", glyph: null, tasks: none });
      return out;
    }
    if (groupBy === "status") {
      const defs: [string, string, StatusLike, (t: Task) => boolean][] = [
        ["todo", "To do", { status: "todo" }, (t) => !isDone(t) && isNotStarted(t)],
        ["in_progress", "In progress", { status: "in_progress" }, (t) => isStarted(t) && !isBlocked(t)],
        ["blocked", "Blocked", { status: "blocked", status_category: "active", status_blocked: true }, (t) => isBlocked(t)],
        ["done", "Done", { status: "done" }, (t) => isDone(t)],
      ];
      return defs.map(([key, name, glyph, match]) => ({
        key,
        name,
        glyph: <StIcon task={glyph} size={13} />,
        tasks: tasks.filter(match),
      }));
    }
    if (groupBy === "assignee") {
      const by = new Map<string, Task[]>();
      const none: Task[] = [];
      for (const t of tasks) {
        if (!t.assignee_id) none.push(t);
        else by.set(t.assignee_id, [...(by.get(t.assignee_id) ?? []), t]);
      }
      const out: Group[] = [...by.entries()]
        .map(([id, ts]) => ({
          key: id,
          name: memberById.get(id)?.name ?? "Member",
          glyph: <OvAv member={toAv(id) ?? { id, name: "Member" }} />,
          tasks: ts,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (none.length)
        out.push({ key: "none", name: "Unassigned", glyph: <OvAv member={null} />, tasks: none });
      return out;
    }
    return [{ key: "all", name: "All tasks", glyph: null, tasks }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, tasks, visibleProjects, projectById, memberById]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (milestones.length) out.push({ type: "ms" });
    for (const G of groups) {
      if (!G.tasks.length && !G.project) continue;
      if (groupBy !== "none") out.push({ type: "g", G });
      G.tasks
        .map((t) => ({ t, span: spanOf(t, ws)! }))
        .sort((a, b) => compareRows(sort, a, b))
        .forEach((r) => out.push({ type: "t", ...r }));
    }
    return out;
  }, [groups, groupBy, milestones.length, ws, sort]);
  const H = rows.length * RH;
  const rowY = useMemo(() => {
    const m = new Map<string, { y: number; span: Span }>();
    rows.forEach((r, i) => {
      if (r.type === "t") m.set(r.t.id, { y: i * RH + RH / 2, span: r.span });
    });
    return m;
  }, [rows]);

  /* ── Drag: tasks (rescheduleTask) and project bars (updateProject) ── */
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);

  const persistTask = useCallback(
    async (task: Task, span: Span, mode: "move" | "resize", delta: number) => {
      if (!delta) return;
      const shift = (iso: string) => new Date(new Date(iso).getTime() + delta * DAY).toISOString();
      let patch: Parameters<typeof rescheduleTask>[0];
      let optimistic: Partial<Task>;
      if (mode === "resize") {
        const start = new Date(task.scheduled_start!);
        const end = new Date(task.scheduled_end ?? task.scheduled_start!);
        const next = new Date(end.getTime() + delta * DAY);
        if (next <= start) return;
        patch = { taskId: task.id, scheduledEnd: next.toISOString() };
        optimistic = { scheduled_end: next.toISOString() };
      } else if (span.kind === "range") {
        patch = {
          taskId: task.id,
          scheduledStart: shift(task.scheduled_start!),
          scheduledEnd: task.scheduled_end ? shift(task.scheduled_end) : undefined,
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
      const key = tasksQueryOptions(propertyId).queryKey;
      qc.setQueryData<Task[]>(key, (prev) =>
        (prev ?? []).map((t) => (t.id === task.id ? { ...t, ...optimistic } : t)),
      );
      const res = await rescheduleTask(patch);
      const n = Math.abs(delta);
      if ("error" in res) toast.error(res.error);
      else
        toast.success(
          mode === "resize"
            ? `${delta > 0 ? "Extended" : "Shortened"} “${task.title}” by ${n} day${n > 1 ? "s" : ""}`
            : `Moved “${task.title}” ${n} day${n > 1 ? "s" : ""} ${delta > 0 ? "later" : "earlier"}`,
          { duration: 2200 },
        );
      void qc.invalidateQueries({ queryKey: key });
    },
    [qc, propertyId],
  );

  const persistProject = useCallback(
    async (p: ProjectTracking, mode: "move" | "resize", delta: number) => {
      if (!delta) return;
      const a = parseDay(p.start_date);
      const b = parseDay(p.target_date);
      const patch: { start_date?: string; target_date?: string } = {};
      if (mode === "resize") {
        const end = b ?? a;
        if (!end) return;
        const next = addDays(end, delta);
        if (a && next < a) return;
        patch.target_date = toDay(next);
      } else {
        if (a) patch.start_date = toDay(addDays(a, delta));
        if (b) patch.target_date = toDay(addDays(b, delta));
      }
      const key = projectsTrackingQueryOptions(propertyId).queryKey;
      qc.setQueryData<ProjectTracking[]>(key, (prev) =>
        (prev ?? []).map((r) => (r.id === p.id ? { ...r, ...patch } : r)),
      );
      const res = await updateProject(p.id, patch);
      if ("error" in res) toast.error(res.error);
      else {
        const n = Math.abs(delta);
        toast.success(
          mode === "resize"
            ? `Moved “${p.name}” target ${n} day${n > 1 ? "s" : ""} ${delta > 0 ? "later" : "earlier"}`
            : `Moved “${p.name}” ${n} day${n > 1 ? "s" : ""} ${delta > 0 ? "later" : "earlier"}`,
          { duration: 2200 },
        );
      }
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    },
    [qc, propertyId],
  );

  function startDrag(
    e: React.PointerEvent,
    kind: Drag["kind"],
    id: string,
    mode: Drag["mode"],
    commit: (delta: number) => void,
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
      const next = Math.round(dx / dw);
      if (next !== delta) {
        delta = next;
        setDrag({ kind, id, mode, delta });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 80);
      commit(delta);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /* ── Scroll: right pane drives the left (gr8r's tlAfter) ── */
  const rightRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const todayX = X(today);
  useLayoutEffect(() => {
    const el = rightRef.current;
    if (el) el.scrollLeft = Math.max(0, todayX - 160);
    // Re-centre on zoom change only, not on every data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  const jumpToday = () =>
    rightRef.current?.scrollTo({ left: Math.max(0, todayX - 160), behavior: "smooth" });

  /* ── Header ── */
  const months = useMemo(() => {
    const out: { d: Date; n: number; k: string }[] = [];
    for (let i = 0; i < nDays; i++) {
      const d = addDays(ws, i);
      const k = `${d.getMonth()}-${d.getFullYear()}`;
      const last = out[out.length - 1];
      if (last && last.k === k) last.n++;
      else out.push({ d, n: 1, k });
    }
    return out;
  }, [ws, nDays]);
  const todayIdx = diffDays(today, ws);

  /* ── Bars ── */
  const barNodes: ReactNode[] = [];
  rows.forEach((r, i) => {
    const y = i * RH;
    if (r.type === "g") {
      barNodes.push(<div key={`bg-${i}`} className="tl-rowbg g" style={{ top: y }} />);
      const p = r.G.project;
      const ps = p ? projectSpan(p, ws) : null;
      if (p && ps) {
        const d = drag?.kind === "project" && drag.id === p.id ? drag : null;
        const s = ps.s + (d?.mode === "move" ? d.delta : 0);
        const e = Math.max(s, ps.e + (d?.mode === "move" ? d.delta : 0) + (d?.mode === "resize" ? d.delta : 0));
        const x = s * dw;
        const w = Math.max(dw, (e - s + 1) * dw);
        const pr = progressPct(p.done, p.total);
        const tip = `${p.name} · ${fmt(addDays(ws, s))} → ${fmt(addDays(ws, e))} · ${pr}%`;
        barNodes.push(
          <div
            key={`pb-${p.id}`}
            className={d ? "bar dragging" : "bar"}
            role="button"
            tabIndex={0}
            title={tip}
            aria-label={tip}
            style={{ ...cVar(g8Color(p.color)), left: x, top: y + 7, width: w, fontWeight: 600 } as CSSVars}
            onPointerDown={(ev) =>
              startDrag(ev, "project", p.id, "move", (delta) => void persistProject(p, "move", delta))
            }
            onClick={() => {
              if (!suppressClick.current) openProject(p.id, "timeline");
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") openProject(p.id, "timeline");
            }}
          >
            <span className="pf" style={{ width: `${pr}%` }} />
            {w > 110 ? <span className="trunc">{p.name}</span> : null}
            <span
              aria-hidden="true"
              style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 8, cursor: "ew-resize" }}
              onPointerDown={(ev) =>
                startDrag(ev, "project", p.id, "resize", (delta) => void persistProject(p, "resize", delta))
              }
            />
          </div>,
        );
      }
      return;
    }
    if (r.type === "ms") {
      barNodes.push(<div key={`bg-${i}`} className="tl-rowbg" style={{ top: y }} />);
      const byDate = new Map<string, typeof milestones>();
      for (const m of milestones) byDate.set(m.due_date, [...(byDate.get(m.due_date) ?? []), m]);
      const pts = [...byDate.entries()]
        .sort(([a], [b]) => (a > b ? 1 : -1))
        .map(([date, list]) => ({ date, list, x: X(parseDay(date)!) + dw / 2 }));
      pts.forEach((pt, j) => {
        const room = (pts[j + 1] ? pts[j + 1]!.x : Infinity) - pt.x - 24;
        const first = pt.list[0]!;
        const name = first.name + (pt.list.length > 1 ? ` +${pt.list.length - 1}` : "");
        const tip =
          pt.list.map((m) => m.name + (m.project ? ` (${m.project.name})` : "")).join(" · ") +
          " · " +
          fmt(parseDay(pt.date)!);
        const allDone = pt.list.every((m) => m.completed_at);
        barNodes.push(
          <div
            key={`ms-${pt.date}`}
            className="ms-w"
            style={{ left: pt.x - 6, top: y + 9, opacity: allDone ? 0.55 : undefined }}
            data-tip={tip}
            tabIndex={0}
            aria-label={`Milestone: ${tip}`}
          >
            <span
              className="ms"
              style={first.project ? { background: g8Color(first.project.color) } : undefined}
            />
            {room >= 28 ? (
              <span
                className="ms-l"
                style={{ maxWidth: Number.isFinite(room) ? Math.round(room) : undefined }}
              >
                {name}
              </span>
            ) : null}
          </div>,
        );
      });
      return;
    }
    const t = r.t;
    const d = drag?.kind === "task" && drag.id === t.id ? drag : null;
    const s = r.span.s + (d?.mode === "move" ? d.delta : 0);
    const e = Math.max(s, r.span.e + (d?.mode === "move" ? d.delta : 0) + (d?.mode === "resize" ? d.delta : 0));
    const x = s * dw;
    const w = Math.max(dw, (e - s + 1) * dw);
    const proj = t.project_id ? projectById.get(t.project_id) : undefined;
    const c =
      groupBy === "status" || groupBy === "none"
        ? g8Color(proj?.color ?? "slate")
        : statusColor(t);
    const inside = w > 110;
    const total = progress.total.get(t.id) ?? 0;
    const pct = isDone(t) ? 100 : total ? Math.round(((progress.done.get(t.id) ?? 0) / total) * 100) : 0;
    const tip = `${t.title} · ${fmt(addDays(ws, s))}${e !== s ? ` → ${fmt(addDays(ws, e))}` : ""}`;
    barNodes.push(<div key={`bg-${i}`} className="tl-rowbg" style={{ top: y }} />);
    barNodes.push(
      <div
        key={`b-${t.id}`}
        className={["bar", isDone(t) ? "done" : "", d ? "dragging" : ""].filter(Boolean).join(" ")}
        role="button"
        tabIndex={0}
        title={tip}
        aria-label={tip}
        style={{ ...cVar(c), left: x, top: y + 7, width: w }}
        onPointerDown={(ev) =>
          startDrag(ev, "task", t.id, "move", (delta) => void persistTask(t, r.span, "move", delta))
        }
        onClick={() => {
          if (!suppressClick.current) openTask(t.id);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openTask(t.id);
          }
        }}
      >
        <span className="pf" style={{ width: `${pct}%` }} />
        {inside ? (
          <>
            <OvAv member={toAv(t.assignee_id)} />
            <span className="trunc">{t.title}</span>
          </>
        ) : null}
        {r.span.kind === "range" ? (
          <span
            aria-hidden="true"
            style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 8, cursor: "ew-resize" }}
            onPointerDown={(ev) =>
              startDrag(ev, "task", t.id, "resize", (delta) => void persistTask(t, r.span, "resize", delta))
            }
          />
        ) : null}
      </div>,
    );
    if (!inside)
      barNodes.push(
        <div key={`l-${t.id}`} className="bar-lbl" style={{ left: x + w + 8, top: y + 10 }}>
          {t.title}
        </div>,
      );
  });

  const depPaths = deps.map((dep) => {
    const a = rowY.get(dep.blocker);
    const b = rowY.get(dep.blocked);
    if (!a || !b) return null;
    const x1 = (a.span.e + 1) * dw;
    const x2 = b.span.s * dw;
    const conflict = x2 < x1;
    const stroke = conflict ? "var(--g8-amber)" : "var(--g8-text-3)";
    return (
      <g key={`${dep.blocker}-${dep.blocked}`}>
        <path
          d={`M${x1} ${a.y} C ${Math.max(x1 + 10, x2 - 10)} ${a.y}, ${Math.min(x1 + 10, x2 - 10)} ${b.y}, ${x2 - 1} ${b.y}`}
          fill="none"
          stroke={stroke}
          strokeWidth="1.3"
          strokeDasharray={conflict ? "3 3" : undefined}
        />
        <path
          d={`M${x2 - 6} ${b.y - 3.5} L${x2 - 1} ${b.y} L${x2 - 6} ${b.y + 3.5}`}
          fill="none"
          stroke={stroke}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Timeline" icon={<ChartGantt />} />
      <div className="min-h-0 flex-1">
        <div className="page flush">
          <div className="ph">
            <div>
              <h1>Timeline</h1>
              <p>Schedules, dependencies, and milestones across projects.</p>
            </div>
          </div>
          <div className="toolbar" role="toolbar">
            <div className="inwrap">
              <Gi icon={Search} size={13} />
              <input
                className="input search-sm"
                placeholder="Search tasks"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                aria-label="Search tasks"
              />
            </div>
            <FilterMenu filters={filters} onPick={setAddedFacet} customFields={customFields} />
            <Popover>
              <PopoverTrigger render={<button type="button" className="btn btn-ghost" />}>
                <Gi icon={ArrowUpDown} size={14} />
                <span className="hide-m">Sort:</span> {TL_SORT_LABEL[sort]}
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={6} className="w-48 gap-0 p-0">
                <PopoverSection label="Order rows by">
                  {TL_SORTS.map((k) => (
                    <PopoverRow key={k} onClick={() => setSort(k)} selected={sort === k}>
                      <span className="flex-1">{TL_SORT_LABEL[k]}</span>
                    </PopoverRow>
                  ))}
                </PopoverSection>
              </PopoverContent>
            </Popover>
            <div className="seg" style={{ marginLeft: 4 }}>
              {(
                [
                  ["week", "Weeks"],
                  ["month", "Months"],
                ] as const
              ).map(([k, n]) => (
                <button
                  key={k}
                  type="button"
                  className={zoom === k ? "on" : ""}
                  aria-pressed={zoom === k}
                  onClick={() => setZoom(k)}
                >
                  {n}
                </button>
              ))}
            </div>
            <select
              className="select"
              style={{ height: 26, width: "auto", fontSize: 12, marginLeft: 4 }}
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            >
              <option value="project">Group: Project</option>
              <option value="status">Group: Status</option>
              <option value="assignee">Group: Assignee</option>
              <option value="none">No grouping</option>
            </select>
            <button
              type="button"
              className={hideDone ? "btn btn-ghost on" : "btn btn-ghost"}
              aria-pressed={hideDone}
              onClick={() => setHideDone((v) => !v)}
            >
              <Gi icon={CircleCheck} size={14} />
              {hideDone ? "Completed hidden" : "Hide completed"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={jumpToday}>
              <Gi icon={Crosshair} size={14} />
              Today
            </button>
          </div>
          <ActiveFilterBar
            propertyId={propertyId}
            filters={filters}
            onChange={setFilters}
            currentUserId={viewerId ?? ""}
            addedFacet={addedFacet}
            onResolveAdded={() => setAddedFacet(null)}
            onPick={setAddedFacet}
          />

          {rows.length === 0 ? (
            <div className="empty-state">
              <div className="glyph">
                <Gi icon={ChartGantt} size={20} />
              </div>
              <h2 className="es-h">Nothing on the timeline</h2>
              <p>Give tasks a due date or a scheduled window — or projects a start and target — to see them here.</p>
              <Link href={`/p/${propertyId}/tasks/new`} className="btn btn-primary btn-sm">
                New task
              </Link>
            </div>
          ) : (
            <div className="tl">
              <div className="tl-left">
                <div className="tl-head">Task</div>
                <div className="tl-rows" ref={leftRef}>
                  {rows.map((r, i) => {
                    if (r.type === "ms")
                      return (
                        <div key="ms" className="tl-row g">
                          <Gi icon={Diamond} size={12} />
                          Milestones
                          <span className="faint" style={{ fontWeight: 500 }}>
                            {milestones.length}
                          </span>
                        </div>
                      );
                    if (r.type === "g") {
                      const p = r.G.project;
                      return (
                        <div
                          key={`g-${r.G.key}`}
                          className="tl-row g"
                          style={p ? { cursor: "pointer" } : undefined}
                          onClick={p ? () => openProject(p.id) : undefined}
                        >
                          {r.G.glyph}
                          <span className="trunc">{r.G.name}</span>
                          <span className="faint" style={{ fontWeight: 500 }}>
                            {r.G.tasks.length}
                          </span>
                        </div>
                      );
                    }
                    const t = r.t;
                    const sub = progress.total.get(t.id);
                    return (
                      <div
                        key={`t-${t.id}-${i}`}
                        className="tl-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openTask(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") openTask(t.id);
                        }}
                      >
                        <span title={t.status_name ?? undefined} style={{ display: "inline-flex" }}>
                          <StIcon task={t} size={13} />
                        </span>
                        <span
                          className="trunc grow"
                          style={isDone(t) ? { color: "var(--g8-text-3)" } : undefined}
                        >
                          {t.title}
                        </span>
                        {sub ? (
                          <span className="faint num" style={{ fontSize: 11 }}>
                            {progress.done.get(t.id) ?? 0}/{sub}
                          </span>
                        ) : null}
                        <OvAv member={toAv(t.assignee_id)} />
                      </div>
                    );
                  })}
                  <div style={{ height: 40 }} />
                </div>
              </div>
              <div
                className="tl-right"
                ref={rightRef}
                onScroll={(e) => {
                  if (leftRef.current) leftRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
              >
                <div className="tl-head" style={{ width: W }}>
                  <div className="tl-months">
                    {months.map((m) => (
                      <div key={m.k} style={{ width: m.n * dw }}>
                        <span>
                          {m.d.toLocaleDateString(undefined, { month: "long" })} {m.d.getFullYear()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="tl-days">
                    {zoom === "week"
                      ? Array.from({ length: nDays }, (_, i) => {
                          const d = addDays(ws, i);
                          return (
                            <div
                              key={i}
                              style={{ width: dw }}
                              className={i === todayIdx ? "today" : undefined}
                            >
                              {d.getDate()}
                            </div>
                          );
                        })
                      : Array.from({ length: nDays / 7 }, (_, i) => {
                          const d = addDays(ws, i * 7);
                          return (
                            <div key={i} style={{ width: dw * 7 }}>
                              {MON[d.getMonth()]} {d.getDate()}
                            </div>
                          );
                        })}
                  </div>
                </div>
                <div className="tl-grid" style={{ width: W, height: H + 40 }}>
                  {zoom === "week"
                    ? Array.from({ length: nDays }, (_, i) => {
                        const d = addDays(ws, i);
                        return d.getDay() === 0 || d.getDay() === 6 ? (
                          <div key={`we-${i}`} className="tl-we" style={{ left: i * dw, width: dw }} />
                        ) : null;
                      })
                    : null}
                  {Array.from({ length: nDays / 7 }, (_, i) => (
                    <div key={`gl-${i}`} className="tl-gl" style={{ left: i * 7 * dw }} />
                  ))}
                  {todayIdx >= 0 && todayIdx < nDays ? (
                    <div className="tl-today" style={{ left: todayX + dw / 2 }} title="Today" />
                  ) : null}
                  {barNodes}
                  <svg
                    className="tl-deps"
                    width={W}
                    height={H}
                    viewBox={`0 0 ${W} ${H}`}
                    aria-hidden="true"
                  >
                    {depPaths}
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
