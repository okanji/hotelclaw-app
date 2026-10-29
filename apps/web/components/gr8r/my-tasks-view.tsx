"use client";

import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { MessageResponse } from "stream-chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ClockAlert,
  Ellipsis,
  GripVertical,
  AtSign,
  Hourglass,
  TriangleAlert,
  History,
  Link2,
  List,
  ListChecks,
  PenLine,
  Plus,
  Repeat,
  Search,
  SquareArrowOutUpRight,
  Sun,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Gi } from "@/components/gr8r/icon";
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import { useOpenChannel } from "@/lib/chat/use-open-channel";
import { PageHeader } from "@/components/shell/page-header";
import { MyTasksIcon } from "@/components/shell/clickup-icons";
import { useUrlTab } from "@/components/projects/workspace-shell";
import { ActivityLogFeed } from "@/components/activity/activity-log";
import { AssigneeStack } from "@/components/tasks/assignee-stack";
import {
  PriorityMenuContent,
  StatusMenuContent,
  dateInputToIso,
  toDateInputValue,
} from "@/components/tasks/task-property-menus";
import { createTask, updateTask } from "@/components/tasks/actions";
import type { Task } from "@/components/tasks/kanban";
import { mentionsQueryOptions, tasksQueryOptions } from "@/lib/query/section-queries";
import { projectsQueryOptions } from "@/lib/query/project-queries";
import { useTaskStatusOptions } from "@/lib/query/status-queries";
import { useAssigneesMap, type AssigneeInfo } from "@/lib/tasks/use-assignees";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import { taskHref } from "@/lib/tasks/task-href";
import { taskKey } from "@/lib/tasks/task-key";
import { isAssignedTo, taskAssigneeIds } from "@/lib/tasks/assignees";
import {
  assignedRows,
  createdRows,
  parseMyTasksTab,
} from "@/lib/tasks/my-tasks-lens";
import {
  CATEGORY_META,
  describeStatus,
  isBlocked,
  isDone,
  type ColumnDef,
} from "@/lib/tasks/statuses";
import type { EntityColor, TaskPriority, TaskStatus } from "@/lib/db/types";
import {
  G8PriorityIcon,
  G8StatusIcon,
  PRIORITY_NAME,
  cVar,
  dayDiff,
  g8Color,
  relDate,
  startOfDay,
} from "./my-tasks-glyphs";

/**
 * My Tasks — gr8r-studio's `pageMyTasks` (src/pages/my-tasks.js) over our
 * tasks cache: `.page.flush` › `.ph` (title + "N due today · N overdue · N
 * upcoming", a `.seg` view switch) › `.toolbar` (search + sort) › `.list-wrap`
 * › `.tlist` grouped Overdue / Today / Upcoming / Completed (Completed folded),
 * every row a gr8r `.trow` with the round complete-check, key + title, and
 * Project / Status / Priority / Due cells that open our real pickers.
 *
 * Our lenses map onto the `.seg`: Assigned (gr8r's page — `?tab=focus` and
 * `?tab=assigned` both land here), Created (the same grouping over work you
 * filed, plus an Assignee column), Activity (your `activity_log` rows).
 */

type Tab = "mine" | "created" | "activity";
type SortField = "due" | "priority" | "title" | "status" | "created";

const SORT_NAME: Record<SortField, string> = {
  due: "Due date",
  priority: "Priority",
  title: "Title",
  status: "Status",
  created: "Created",
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const STATUS_ORDER: Record<string, number> = {
  open: 0,
  unstarted: 1,
  active: 2,
  done: 3,
  closed: 4,
};

/** gr8r `LCOLS` widths. */
const LCOLS = {
  project: ["Project", "160px"],
  assignee: ["Assignee", "150px"],
  status: ["Status", "126px"],
  priority: ["Priority", "108px"],
  due: ["Due date", "104px"],
} as const;
type Col = keyof typeof LCOLS;

type GroupKey = "blocked" | "overdue" | "today" | "upcoming" | "completed";

const DAY = 24 * 60 * 60 * 1000;

/** Groups a row can be dragged OUT of (reschedule), and those that take a drop. */
const DRAGGABLE_GROUPS: GroupKey[] = ["overdue", "today", "upcoming"];
const DROP_HINT: Partial<Record<GroupKey, string>> = {
  today: "due today",
  upcoming: "due tomorrow",
};

/** due_at a drop assigns — the old Focus bucket logic: end of working day, local. */
function dueAtForDrop(group: GroupKey, today: number): string | null {
  if (group !== "today" && group !== "upcoming") return null;
  const d = new Date(today);
  d.setDate(d.getDate() + (group === "today" ? 0 : 1));
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

const EMPTY_TASKS: Task[] = [];

export function MyTasksView({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const [rawTab, setRawTab] = useUrlTab("focus");
  const parsed = parseMyTasksTab(rawTab);
  const tab: Tab =
    parsed === "created" ? "created" : parsed === "activity" ? "activity" : "mine";
  const setTab = (t: Tab) =>
    setRawTab(t === "mine" ? "focus" : t === "created" ? "created" : "activity");

  const { data: tasks = EMPTY_TASKS, isPending } = useQuery(
    tasksQueryOptions(propertyId),
  );
  const { data: projects = [] } = useQuery(projectsQueryOptions(propertyId));
  const projectColor = useMemo(
    () => new Map(projects.map((p) => [p.id, p.color as EntityColor])),
    [projects],
  );

  // Stable per mount — the bucket math must not shift mid-render.
  const [today] = useState(() => startOfDay(new Date()));
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ f: SortField; dir: 1 | -1 }>({ f: "due", dir: 1 });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Memoized lens rows (AGENTS.md "My tasks": a fresh array per render loops).
  const lens = useMemo(
    () =>
      tab === "created" ? createdRows(tasks, userId) : assignedRows(tasks, userId),
    [tab, tasks, userId],
  );

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? lens.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            taskKey(t).toLowerCase().includes(needle),
        )
      : lens;
    const key = (t: Task): string | number => {
      switch (sort.f) {
        case "due":
          return t.due_at ?? "￿";
        case "priority":
          return PRIORITY_ORDER[t.priority];
        case "title":
          return t.title.toLowerCase();
        case "status":
          return STATUS_ORDER[t.status_category ?? "open"] ?? 0;
        case "created":
          return t.created_at ?? "";
      }
    };
    return [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (ka > kb ? 1 : ka < kb ? -1 : 0) * sort.dir;
    });
  }, [lens, q, sort]);

  const groups = useMemo(() => {
    const blocked: Task[] = [];
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const upcoming: Task[] = [];
    const completed: Task[] = [];
    for (const t of sorted) {
      if (isDone(t)) {
        completed.push(t);
        continue;
      }
      // Assigned only: blocked work is pulled out above Overdue (old Focus tab).
      if (tab === "mine" && isBlocked(t)) {
        blocked.push(t);
        continue;
      }
      const n = t.due_at ? dayDiff(t.due_at, today) : null;
      if (n !== null && n < 0) overdue.push(t);
      else if (n === 0) dueToday.push(t);
      else upcoming.push(t);
    }
    const out: Group[] = [
      {
        key: "overdue" as GroupKey,
        name: "Overdue",
        icon: ClockAlert,
        color: "var(--g8-red)",
        tasks: overdue,
      },
      { key: "today" as GroupKey, name: "Today", icon: Sun, tasks: dueToday },
      {
        key: "upcoming" as GroupKey,
        name: "Upcoming",
        icon: CalendarDays,
        tasks: upcoming,
      },
      {
        key: "completed" as GroupKey,
        name: "Completed",
        icon: CircleCheck,
        color: "var(--g8-green)",
        tasks: completed,
        collapsed: true,
      },
    ];
    if (blocked.length > 0)
      out.unshift({
        key: "blocked",
        name: "Blocked — needs unsticking",
        icon: TriangleAlert,
        color: "var(--g8-amber)",
        tasks: blocked,
      });
    return out;
  }, [sorted, today, tab]);

  const byKey = (k: GroupKey) => groups.find((g) => g.key === k)?.tasks.length ?? 0;

  const cols: Col[] =
    tab === "created"
      ? ["project", "assignee", "status", "priority", "due"]
      : ["project", "status", "priority", "due"];
  const tpl = `18px 30px minmax(220px,1fr) ${cols.map((c) => LCOLS[c][1]).join(" ")} 40px`;

  const assigneeIds = useMemo(() => lens.flatMap(taskAssigneeIds), [lens]);
  const assignees = useAssigneesMap(assigneeIds);

  const counts = {
    blocked: byKey("blocked"),
    overdue: byKey("overdue"),
    today: byKey("today"),
    upcoming: byKey("upcoming"),
  };

  // ── Drag-to-reschedule (dnd-kit, as the old Focus tab) ──
  const qc = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : null;

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const group = over.id as GroupKey;
    if (!(group in DROP_HINT)) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const dueAt = dueAtForDrop(group, today);
    // Already in that day — nothing to write.
    if (task.due_at && dueAt && startOfDay(new Date(task.due_at)) === startOfDay(new Date(dueAt)))
      return;
    const key = ["tasks", propertyId];
    const prev = qc.getQueryData<Task[]>(key);
    if (prev)
      qc.setQueryData<Task[]>(
        key,
        prev.map((t) => (t.id === task.id ? { ...t, due_at: dueAt } : t)),
      );
    void updateTask({ taskId: task.id, dueAt }).then((res) => {
      if ("error" in res) {
        if (prev) qc.setQueryData(key, prev);
        toast.error(res.error);
      }
      void qc.invalidateQueries({ queryKey: key });
    });
  }

  const SEG: Array<[Tab, string, LucideIcon]> = [
    ["mine", "Assigned", List],
    ["created", "Created", PenLine],
    ["activity", "Activity", History],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="My tasks" icon={<MyTasksIcon />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page flush">
          <div className="ph">
            <div>
              <h1>My Tasks</h1>
              <p>
                {tab === "activity"
                  ? "Everything you've changed, newest first."
                  : `${counts.today} due today · ${counts.overdue} overdue · ${counts.upcoming} upcoming${counts.blocked ? ` · ${counts.blocked} blocked` : ""}`}
              </p>
            </div>
            <div className="acts">
              <div className="seg" role="tablist" aria-label="View">
                {SEG.map(([k, label, icon]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    className={tab === k ? "on" : ""}
                    onClick={() => setTab(k)}
                  >
                    <Gi icon={icon} size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <a
                className="btn btn-primary"
                href={`/p/${propertyId}/tasks/new`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  window.history.pushState(null, "", `/p/${propertyId}/tasks/new`);
                  window.dispatchEvent(new Event("hotelclaw:pathname"));
                }}
              >
                <Gi icon={Plus} size={14} />
                New task
              </a>
            </div>
          </div>

          {tab === "activity" ? (
            <div style={{ padding: "0 var(--g8-gutter) 72px" }}>
              <ActivityLogFeed
                propertyId={propertyId}
                scope={{ kind: "actor", id: userId }}
                meId={userId}
                showPersonFilter={false}
              />
            </div>
          ) : (
            <>
              <div className="toolbar" role="toolbar">
                <div className="inwrap">
                  <Gi icon={Search} size={13} />
                  <input
                    className="input search-sm"
                    placeholder="Search tasks"
                    aria-label="Search tasks"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="btn btn-ghost">
                    <Gi icon={ArrowUpDown} size={14} />
                    <span className="hide-m">Sort:</span> {SORT_NAME[sort.f]}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    {(Object.keys(SORT_NAME) as SortField[]).map((f) => (
                      <DropdownMenuItem
                        key={f}
                        onClick={() =>
                          setSort((s) =>
                            s.f === f ? { f, dir: s.dir === 1 ? -1 : 1 } : { f, dir: 1 },
                          )
                        }
                      >
                        {SORT_NAME[f]}
                        {sort.f === f ? (
                          <span className="ml-auto">
                            <Gi icon={sort.dir > 0 ? ArrowUp : ArrowDown} size={12} />
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="sp" />
              </div>

              <div className="list-wrap">
                {isPending ? (
                  <div className="empty-state sm">
                    <p>Loading your tasks…</p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    onDragStart={(e) => setDraggingId(String(e.active.id))}
                    onDragEnd={onDragEnd}
                    onDragCancel={() => setDraggingId(null)}
                  >
                  <div className="tlist" role="table" aria-label="Tasks">
                    <div
                      className="thead"
                      role="row"
                      style={{ "--g8-cols": tpl } as CSSProperties}
                    >
                      <div />
                      <div />
                      <SortHead
                        label="Task"
                        field="title"
                        sort={sort}
                        onSort={setSort}
                      />
                      {cols.map((c) =>
                        c === "project" || c === "assignee" ? (
                          <div key={c}>{LCOLS[c][0]}</div>
                        ) : (
                          <SortHead
                            key={c}
                            label={LCOLS[c][0]}
                            field={c}
                            sort={sort}
                            onSort={setSort}
                          />
                        ),
                      )}
                      <div />
                    </div>
                    {groups.map((g) => {
                      const coll = collapsed[g.key] ?? g.collapsed ?? false;
                      return (
                        <GroupBlock
                          key={g.key}
                          group={g}
                          collapsed={coll}
                          onToggle={() =>
                            setCollapsed((s) => ({ ...s, [g.key]: !coll }))
                          }
                          propertyId={propertyId}
                          userId={userId}
                          cols={cols}
                          tpl={tpl}
                          today={today}
                          projectColor={projectColor}
                          assignees={assignees}
                          dragging={draggingId !== null}
                        />
                      );
                    })}
                  </div>
                  <PortalDragOverlay>
                    {draggingTask ? (
                      <div
                        className="panel"
                        style={{
                          width: "fit-content",
                          maxWidth: 320,
                          padding: "6px 12px",
                          fontSize: "var(--g8-fs-sm)",
                          fontWeight: 500,
                          boxShadow: "var(--g8-shadow-pop)",
                        }}
                      >
                        <span className="trunc">{draggingTask.title}</span>
                      </div>
                    ) : null}
                  </PortalDragOverlay>
                  </DndContext>
                )}
                {tab === "mine" && !isPending ? (
                  <FollowUps
                    propertyId={propertyId}
                    userId={userId}
                    tasks={tasks}
                    today={today}
                    assignees={assignees}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SortHead({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: SortField;
  sort: { f: SortField; dir: 1 | -1 };
  onSort: (s: { f: SortField; dir: 1 | -1 }) => void;
}) {
  const on = sort.f === field;
  return (
    <div
      role="columnheader"
      style={{ cursor: "pointer" }}
      onClick={() => onSort({ f: field, dir: on && sort.dir === 1 ? -1 : 1 })}
    >
      {label} {on ? <Gi icon={sort.dir > 0 ? ArrowUp : ArrowDown} size={11} /> : null}
    </div>
  );
}

type Group = {
  key: GroupKey;
  name: string;
  icon: LucideIcon;
  color?: string;
  tasks: Task[];
  collapsed?: boolean;
};

function GroupBlock({
  group: g,
  collapsed,
  onToggle,
  propertyId,
  userId,
  cols,
  tpl,
  today,
  projectColor,
  assignees,
  dragging,
}: {
  dragging: boolean;
  group: Group;
  collapsed: boolean;
  onToggle: () => void;
  propertyId: string;
  userId: string;
  cols: Col[];
  tpl: string;
  today: number;
  projectColor: Map<string, EntityColor>;
  assignees: Record<string, AssigneeInfo>;
}) {
  const [composing, setComposing] = useState(false);
  const hint = DROP_HINT[g.key];
  const { setNodeRef, isOver } = useDroppable({ id: g.key, disabled: !hint });
  const canDrag = DRAGGABLE_GROUPS.includes(g.key);
  return (
    <div
      ref={setNodeRef}
      style={
        isOver
          ? { background: "var(--g8-accent-soft)", boxShadow: "inset 0 0 0 1px var(--g8-accent)" }
          : undefined
      }
    >
      <div className="grp">
        <button
          type="button"
          className="ibtn ibtn-xs"
          aria-expanded={!collapsed}
          aria-label="Toggle group"
          onClick={onToggle}
        >
          <Gi icon={collapsed ? ChevronRight : ChevronDown} size={13} />
        </button>
        <span style={g.color ? { color: g.color, display: "inline-flex" } : { display: "inline-flex" }}>
          <Gi icon={g.icon} size={14} />
        </span>
        <span>{g.name}</span>
        <span className="cnt">{g.tasks.length}</span>
        {dragging && hint ? (
          <span className="cnt" style={{ fontWeight: 400 }}>
            drop → {hint}
          </span>
        ) : null}
        <button
          type="button"
          className="ibtn ibtn-xs"
          aria-label={`Add task to ${g.name}`}
          onClick={() => setComposing(true)}
        >
          <Gi icon={Plus} size={13} />
        </button>
      </div>
      {collapsed
        ? null
        : g.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              propertyId={propertyId}
              cols={cols}
              tpl={tpl}
              today={today}
              projectColor={projectColor}
              assignees={assignees}
              draggable={canDrag}
            />
          ))}
      {collapsed ? null : composing ? (
        <Composer
          propertyId={propertyId}
          userId={userId}
          group={g.key}
          today={today}
          onDone={() => setComposing(false)}
        />
      ) : (
        <button type="button" className="addrow" onClick={() => setComposing(true)}>
          <Gi icon={Plus} size={14} />
          Add task
        </button>
      )}
    </div>
  );
}

/** gr8r's inline composer: Enter adds (assigned to you, dated by the group), Esc cancels. */
function Composer({
  propertyId,
  userId,
  group,
  today,
  onDone,
}: {
  propertyId: string;
  userId: string;
  group: GroupKey;
  today: number;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function commit() {
    const title = value.trim();
    if (!title) {
      onDone();
      return;
    }
    setBusy(true);
    const created = await createTask({ propertyId, title, assigneeIds: [userId] });
    if ("error" in created) {
      setBusy(false);
      toast.error(created.error);
      return;
    }
    let dueAt: string | undefined;
    if (group === "today" || group === "upcoming") {
      const d = new Date(today);
      d.setDate(d.getDate() + (group === "today" ? 0 : 3));
      d.setHours(17, 0, 0, 0);
      dueAt = d.toISOString();
    }
    const status: TaskStatus | null =
      group === "completed" ? "done" : group === "blocked" ? "blocked" : null;
    if (dueAt || status) {
      const res = await updateTask({
        taskId: created.taskId,
        ...(dueAt ? { dueAt } : {}),
        ...(status ? { status } : {}),
      });
      if ("error" in res) toast.error(res.error);
    }
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    setBusy(false);
    setValue("");
  }

  return (
    <div className="addrow" style={{ background: "var(--g8-surface-2)" }}>
      <Gi icon={Plus} size={14} />
      <input
        className="inline-in"
        autoFocus
        disabled={busy}
        value={value}
        placeholder="Task name — press Enter to add, Esc to cancel"
        aria-label="New task name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!value.trim()) onDone();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
      />
    </div>
  );
}

/** Optimistic patch of one task in the shared cache, then a refetch. */
function useTaskPatch(propertyId: string) {
  const qc = useQueryClient();
  return useCallback(
    async (
      taskId: string,
      optimistic: Partial<Task>,
      write: () => Promise<{ ok: true } | { error: string }>,
    ) => {
      const key = ["tasks", propertyId];
      const prev = qc.getQueryData<Task[]>(key);
      if (prev) {
        qc.setQueryData<Task[]>(
          key,
          prev.map((t) => (t.id === taskId ? { ...t, ...optimistic } : t)),
        );
      }
      const res = await write();
      if ("error" in res) {
        if (prev) qc.setQueryData(key, prev);
        toast.error(res.error);
      }
      void qc.invalidateQueries({ queryKey: key });
    },
    [qc, propertyId],
  );
}

function statusPatch(option: Pick<ColumnDef, "id" | "label" | "category" | "isBlocked" | "color">): Partial<Task> {
  const legacy: TaskStatus = option.isBlocked
    ? "blocked"
    : CATEGORY_META[option.category].legacy;
  const done = option.category === "done" || option.category === "closed";
  return {
    status: legacy,
    status_name: option.label,
    status_category: option.category,
    status_color: option.color,
    status_blocked: option.isBlocked,
    completed_at: done ? new Date().toISOString() : null,
  };
}

function TaskRow({
  task: t,
  propertyId,
  cols,
  tpl,
  today,
  projectColor,
  assignees,
  draggable = false,
}: {
  draggable?: boolean;
  task: Task;
  propertyId: string;
  cols: Col[];
  tpl: string;
  today: number;
  projectColor: Map<string, EntityColor>;
  assignees: Record<string, AssigneeInfo>;
}) {
  const openTask = useOpenTask(propertyId);
  const patch = useTaskPatch(propertyId);
  const options = useTaskStatusOptions(propertyId, t.list_id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: t.id,
    disabled: !draggable,
  });
  const done = isDone(t);
  const current = t.status_id ?? t.status;
  const shown = describeStatus(options, current, t);

  const setStatus = (id: string) => {
    const opt = options.find((o) => o.id === id);
    const optimistic = opt ? statusPatch(opt) : {};
    void patch(t.id, optimistic, () => updateTask({ taskId: t.id, status: id }));
  };

  const toggleDone = () => {
    const target = done
      ? options.find((o) => o.category === "open") ?? options[0]
      : options.find((o) => o.category === "closed") ??
        options.find((o) => o.category === "done");
    if (!target) return;
    setStatus(target.id);
  };

  const cell = (c: Col) => {
    switch (c) {
      case "project":
        return t.project_name ? (
          <span className="pillbtn" style={{ cursor: "default" }}>
            <span
              className="pdot"
              style={cVar(g8Color(t.project_id ? projectColor.get(t.project_id) : null))}
            />
            <span className="trunc">{t.project_name}</span>
          </span>
        ) : (
          <span className="pillbtn empty" style={{ cursor: "default" }}>
            <span className="trunc">No project</span>
          </span>
        );
      case "assignee": {
        const ids = taskAssigneeIds(t);
        const first = ids[0] ? assignees[ids[0]]?.name : null;
        return (
          <span className={`pillbtn ${ids.length ? "" : "empty"}`} style={{ cursor: "default" }}>
            <AssigneeStack ids={ids} infos={assignees} size={20} max={3} />
            <span className="trunc">
              {ids.length === 0
                ? "Unassigned"
                : `${first ?? "Member"}${ids.length > 1 ? ` +${ids.length - 1}` : ""}`}
            </span>
          </span>
        );
      }
      case "status":
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="pillbtn"
              aria-label={`Status: ${shown.label}`}
            >
              <G8StatusIcon
                category={shown.category}
                blocked={shown.isBlocked}
                color={shown.color}
              />
              <span className="trunc">{shown.label}</span>
            </DropdownMenuTrigger>
            <StatusMenuContent options={options} current={current} onSelect={setStatus} />
          </DropdownMenu>
        );
      case "priority":
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={`pillbtn ${t.priority === "none" ? "empty" : ""}`}
              aria-label="Priority"
            >
              <G8PriorityIcon priority={t.priority} />
              <span>{PRIORITY_NAME[t.priority]}</span>
            </DropdownMenuTrigger>
            <PriorityMenuContent
              onSelect={(priority) =>
                void patch(t.id, { priority }, () => updateTask({ taskId: t.id, priority }))
              }
            />
          </DropdownMenu>
        );
      case "due":
        return <DueCell task={t} today={today} done={done} patch={patch} />;
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`trow ${done ? "done" : ""} ${isDragging ? "dragging" : ""}`}
      role="row"
      style={{ "--g8-cols": tpl } as CSSProperties}
    >
      {draggable ? (
        <div
          className="handle"
          {...attributes}
          {...listeners}
          aria-label={`Reschedule "${t.title}" by dragging`}
          style={{ touchAction: "none" }}
        >
          <Gi icon={GripVertical} size={14} />
        </div>
      ) : (
        <div className="handle" aria-hidden="true" />
      )}
      <div className="c-check">
        <input
          type="checkbox"
          className="check round"
          checked={done}
          onChange={toggleDone}
          aria-label={`Mark ${t.title} ${done ? "not done" : "complete"}`}
        />
      </div>
      <div
        className="ttl"
        role="link"
        tabIndex={0}
        onClick={() => openTask(t.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter") openTask(t.id);
        }}
      >
        <span style={{ width: 18, flexShrink: 0 }} />
        <span className="key">{taskKey(t)}</span>
        <span className="tt">{t.title}</span>
        {t.recurrence ? (
          <span className="meta-mini" title={`Repeats ${t.recurrence}`}>
            <Gi icon={Repeat} size={11} />
          </span>
        ) : null}
        {t.checklist_total ? (
          <span className="meta-mini">
            <Gi icon={ListChecks} size={11} />
            {t.checklist_done ?? 0}/{t.checklist_total}
          </span>
        ) : null}
      </div>
      {cols.map((c) => (
        <div key={c} className={`c-meta c-${c}`}>
          {cell(c)}
        </div>
      ))}
      <div className="c-more">
        <DropdownMenu>
          <DropdownMenuTrigger className="ibtn ibtn-sm" aria-label="More actions">
            <Gi icon={Ellipsis} size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => openTask(t.id)}>
              <SquareArrowOutUpRight className="size-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${window.location.origin}${taskHref(propertyId, t.id)}`)
                  .then(() => toast.success("Link copied"));
              }}
            >
              <Link2 className="size-4" />
              Copy link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function DueCell({
  task: t,
  today,
  done,
  patch,
}: {
  task: Task;
  today: number;
  done: boolean;
  patch: ReturnType<typeof useTaskPatch>;
}) {
  const [open, setOpen] = useState(false);
  const over = !!t.due_at && !done && dayDiff(t.due_at, today) < 0;
  const set = (dueAt: string | null) => {
    setOpen(false);
    void patch(t.id, { due_at: dueAt }, () => updateTask({ taskId: t.id, dueAt }));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`pillbtn ${t.due_at ? (over ? "over" : "") : "empty"}`}
        aria-label="Due date"
      >
        <Gi icon={Calendar} size={13} />
        {t.due_at ? (
          <span className="num">{relDate(t.due_at, today)}</span>
        ) : (
          <span>Set date</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <input
          type="date"
          className="input"
          style={{ width: "100%" }}
          defaultValue={toDateInputValue(t.due_at)}
          onChange={(e) => {
            const iso = dateInputToIso(e.target.value);
            if (iso) set(iso);
          }}
        />
        {t.due_at ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 6, width: "100%" }}
            onClick={() => set(null)}
          >
            Clear date
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** gr8r `ago()`-style short relative time. */
function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * The old Focus tab's two follow-up lenses as gr8r `.panel`s in a `.grid2`
 * under the list: Replies owed (where someone @-mentioned you in the last 7
 * days — the inbox has the full list) and Waiting on others (open tasks you
 * created and handed to someone else).
 */
function FollowUps({
  propertyId,
  userId,
  tasks,
  today,
  assignees,
}: {
  propertyId: string;
  userId: string;
  tasks: Task[];
  today: number;
  assignees: Record<string, AssigneeInfo>;
}) {
  const client = useConnectedStreamClient();
  const openChannel = useOpenChannel(propertyId);
  const openTask = useOpenTask(propertyId);
  const { data: mentionHits = [] } = useQuery(
    mentionsQueryOptions(propertyId, userId, client),
  );
  const [now] = useState(() => Date.now());

  const mentions = useMemo(() => {
    const weekAgo = today - 6 * DAY;
    return (mentionHits ?? [])
      .map((h) => h.message as MessageResponse)
      .filter(
        (m) =>
          m.user?.id !== userId &&
          !!m.created_at &&
          new Date(m.created_at).getTime() >= weekAgo,
      )
      .slice(0, 5);
  }, [mentionHits, userId, today]);

  const delegated = useMemo(
    () =>
      tasks
        .filter((t) => {
          if (t.created_by !== userId || t.parent_id || isDone(t)) return false;
          const ids = taskAssigneeIds(t);
          return ids.length > 0 && !isAssignedTo(t, userId);
        })
        .sort((a, b) => (a.due_at ?? "￿").localeCompare(b.due_at ?? "￿")),
    [tasks, userId],
  );
  const delegatedIds = useMemo(() => delegated.flatMap(taskAssigneeIds), [delegated]);
  const delegatedPeople = useAssigneesMap(delegatedIds);
  const people = { ...assignees, ...delegatedPeople };

  if (mentions.length === 0 && delegated.length === 0) return null;

  return (
    <div className="grid2" style={{ marginTop: 24, paddingLeft: 26 }}>
      <FollowPanel
        icon={AtSign}
        title="Replies owed"
        count={mentions.length}
        hint="Where you were @-mentioned this week."
        action={
          <a
            className="btn btn-ghost btn-sm"
            href={`/p/${propertyId}/inbox`}
          >
            All mentions
          </a>
        }
      >
        {mentions.length === 0 ? (
          <p className="faint" style={{ margin: 0, fontSize: "var(--g8-fs-sm)" }}>
            No new mentions.
          </p>
        ) : (
          mentions.map((m) => {
            const name = m.user?.name ?? m.user?.id ?? "Someone";
            const [type, id] = (m.cid ?? "").split(":");
            const channelName =
              (m as { channel?: { name?: string } }).channel?.name ?? id ?? "channel";
            return (
              <div key={m.id} className="fitem">
                <span className="av sm" style={cVar("var(--g8-blue)")} aria-label={name}>
                  {initialsOf(name)}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b>{name}</b> <span className="muted">in</span>{" "}
                  <span
                    className="obj"
                    role="link"
                    tabIndex={0}
                    onClick={() => id && openChannel(type, id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && id) openChannel(type, id);
                    }}
                  >
                    #{channelName}
                  </span>
                  <div className="muted trunc">
                    {m.text ?? (m.attachments?.length ? "(attachment)" : "")}
                  </div>
                </div>
                {m.created_at ? <time>{ago(m.created_at, now)}</time> : null}
              </div>
            );
          })
        )}
      </FollowPanel>

      <FollowPanel
        icon={Hourglass}
        title="Waiting on others"
        count={delegated.length}
        hint="Tasks you created and handed off — still open."
        flush
      >
        {delegated.length === 0 ? (
          <p className="faint" style={{ margin: "0 14px 14px", fontSize: "var(--g8-fs-sm)" }}>
            Nothing handed off right now.
          </p>
        ) : (
          delegated.map((t) => {
            const n = t.due_at ? dayDiff(t.due_at, today) : null;
            const cls = n === null ? "" : n < 0 ? "over" : n <= 1 ? "soon" : "";
            return (
              <div
                key={t.id}
                className="mini"
                role="button"
                tabIndex={0}
                onClick={() => openTask(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openTask(t.id);
                }}
              >
                <G8StatusIcon
                  category={t.status_category ?? "open"}
                  blocked={!!t.status_blocked}
                  color={t.status_color}
                />
                <span className="tt">{t.title}</span>
                {t.due_at ? (
                  <span className={`due ${cls}`}>{relDate(t.due_at, today)}</span>
                ) : null}
                <AssigneeStack ids={taskAssigneeIds(t)} infos={people} size={20} max={3} />
              </div>
            );
          })
        )}
      </FollowPanel>
    </div>
  );
}

function FollowPanel({
  icon,
  title,
  count,
  hint,
  action,
  flush = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  hint: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="panel" style={{ overflow: "hidden", alignSelf: "start" }}>
      <div className="panel-h">
        <span className="faint" style={{ display: "inline-flex" }}>
          <Gi icon={icon} size={14} />
        </span>
        <h2>{title}</h2>
        <span className="faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {count}
        </span>
        {action ? <div className="acts">{action}</div> : null}
      </div>
      <p className="faint" style={{ margin: "-6px 14px 8px", fontSize: "var(--g8-fs-xs)" }}>
        {hint}
      </p>
      {flush ? children : <div className="panel-b">{children}</div>}
    </section>
  );
}
