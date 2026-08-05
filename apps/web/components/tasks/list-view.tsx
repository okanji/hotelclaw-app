"use client";

import { useMemo, useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  CalendarDays,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask, moveTask, updateTask } from "./actions";
import {
  COLUMNS,
  COLUMN_PILL_CLASS,
  PRIORITY_META,
  PRIORITY_IDS,
  STATUS_IDS,
  computePosition,
  type Task,
} from "./kanban";
import { PriorityBars, StatusIcon } from "./task-icons";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { TaskStatus } from "@/lib/db/types";

type Props = {
  propertyId: string;
  tasks: Task[];
  /** Sub-tasks by parent id — rendered as expandable indented rows. */
  childrenByParent?: Map<string, Task[]>;
  assignees: Record<string, AssigneeInfo>;
  hideDone: boolean;
  onChanged: () => void;
  onOpenFullCreate: (status: TaskStatus) => void;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatDate(iso: string, now: number) {
  const d = new Date(iso);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: day.getFullYear() === today.getFullYear() ? undefined : "2-digit",
  });
}

export function ListView({
  propertyId,
  tasks,
  childrenByParent,
  assignees,
  hideDone,
  onChanged,
  onOpenFullCreate,
}: Props) {
  // Which parents' sub-tasks are expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({
    todo: false,
    in_progress: false,
    blocked: false,
    done: false,
  });

  // Multi-select for bulk actions — a Set of task ids; the floating bar
  // appears while anything is selected. Selection survives status regrouping
  // but drops ids that left the visible set.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const visibleIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks]);
  const activeSelection = useMemo(
    () => new Set([...selected].filter((id) => visibleIds.has(id))),
    [selected, visibleIds],
  );
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      todo: [],
      in_progress: [],
      blocked: [],
      done: [],
    };
    for (const t of tasks) map[t.status].push(t);
    return map;
  }, [tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Sticky table header — matches the row template below */}
      <div className="sticky top-0 z-10 grid h-9 grid-cols-[24px_1fr_120px_140px_140px_180px_32px] items-center gap-3 border-b border-border bg-card px-4 text-sm/[1.2] font-normal text-muted-foreground">
        <span />
        <span>Title</span>
        <span>Priority</span>
        <span>Due</span>
        <span>Assignee</span>
        <span>Updated</span>
        <span />
      </div>

      {STATUS_IDS.map((status) => {
        if (hideDone && status === "done") return null;
        const col = COLUMNS.find((c) => c.id === status)!;
        const rows = grouped[status];
        const isCollapsed = collapsed[status];
        return (
          <section key={status} className="border-b border-border last:border-0">
            <header className="flex h-9 items-center gap-2 px-4">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [status]: !p[status] }))
                }
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${col.label}`}
                className="grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-accent"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>
              <h3
                className={cn(
                  "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
                  COLUMN_PILL_CLASS[col.pillTone].pill,
                )}
              >
                {col.label}
              </h3>
              <span className="text-sm tabular-nums text-faint-foreground">
                {rows.length}
              </span>
              <button
                type="button"
                onClick={() => onOpenFullCreate(status)}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                <Plus className="size-3" />
                New
              </button>
            </header>

            {!isCollapsed ? (
              rows.length === 0 ? (
                <div className="px-6 py-4 text-sm text-faint-foreground">
                  No tasks in this status.
                </div>
              ) : (
                rows.map((task) => {
                  const children = childrenByParent?.get(task.id) ?? [];
                  const isExpanded = expanded.has(task.id);
                  return (
                    <div key={task.id}>
                      <ListRow
                        propertyId={propertyId}
                        task={task}
                        assignee={
                          task.assignee_id
                            ? assignees[task.assignee_id]
                            : undefined
                        }
                        grouped={grouped}
                        onChanged={onChanged}
                        selected={activeSelection.has(task.id)}
                        selectionActive={activeSelection.size > 0}
                        onToggleSelected={() => toggleSelected(task.id)}
                        subtaskCount={children.length}
                        subtasksExpanded={isExpanded}
                        onToggleSubtasks={() => toggleExpanded(task.id)}
                      />
                      {isExpanded
                        ? children.map((child) => (
                            <ListRow
                              key={child.id}
                              propertyId={propertyId}
                              task={child}
                              assignee={
                                child.assignee_id
                                  ? assignees[child.assignee_id]
                                  : undefined
                              }
                              grouped={grouped}
                              onChanged={onChanged}
                              selected={activeSelection.has(child.id)}
                              selectionActive={activeSelection.size > 0}
                              onToggleSelected={() => toggleSelected(child.id)}
                              indent
                            />
                          ))
                        : null}
                    </div>
                  );
                })
              )
            ) : null}
          </section>
        );
      })}

      {activeSelection.size > 0 ? (
        <BulkActionBar
          ids={[...activeSelection]}
          onDone={() => {
            setSelected(new Set());
            onChanged();
          }}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}

/**
 * Floating bulk-action bar (bottom center) — move / prioritize / delete every
 * selected task. Actions run per task through the existing single-task
 * server actions; partial failures surface once.
 */
function BulkActionBar({
  ids,
  onDone,
  onClear,
}: {
  ids: string[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function runAll(fn: (id: string) => Promise<{ error?: string } | { ok: true }>, label: string) {
    startTransition(async () => {
      const results = await Promise.all(ids.map((id) => fn(id)));
      const failed = results.filter((r) => "error" in r && r.error).length;
      if (failed > 0) toast.error(`${label} failed for ${failed} of ${ids.length}`);
      else toast.success(`${label} — ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`);
      onDone();
    });
  }

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-overlay bg-popover px-3 py-1.5 shadow-overlay">
        <span className="pr-1 text-xs font-medium tabular-nums text-foreground">
          {ids.length} selected
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} />
            }
          >
            Move to
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() =>
                  runAll((id) => updateTask({ taskId: id, status: c.id }), `Moved to ${c.label}`)
                }
              >
                <StatusIcon status={c.id} className="size-3.5" />
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} />
            }
          >
            Priority
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            {PRIORITY_IDS.map((pId) => (
              <DropdownMenuItem
                key={pId}
                onClick={() =>
                  runAll(
                    (id) => updateTask({ taskId: id, priority: pId }),
                    `Priority set to ${PRIORITY_META[pId].label}`,
                  )
                }
              >
                <PriorityBars priority={pId} />
                {PRIORITY_META[pId].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => runAll((id) => deleteTask(id), "Deleted")}
        >
          Delete
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-faint-foreground"
          disabled={pending}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function ListRow({
  propertyId,
  task,
  assignee,
  grouped,
  onChanged,
  selected,
  selectionActive,
  onToggleSelected,
  subtaskCount = 0,
  subtasksExpanded = false,
  onToggleSubtasks,
  indent = false,
}: {
  propertyId: string;
  task: Task;
  assignee: AssigneeInfo | undefined;
  grouped: Record<TaskStatus, Task[]>;
  onChanged: () => void;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelected: () => void;
  subtaskCount?: number;
  subtasksExpanded?: boolean;
  onToggleSubtasks?: () => void;
  indent?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());
  const open = useOpenTask(propertyId);
  const priority = PRIORITY_META[task.priority];
  const due = task.due_at ? new Date(task.due_at) : null;
  const overdue =
    due != null && task.status !== "done" && due.getTime() < now;

  function handleTitleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open(task.id);
  }

  function moveTo(status: TaskStatus) {
    if (status === task.status) return;
    const topId = grouped[status][0]?.id;
    const topPos = topId
      ? (grouped[status].find((t) => t.id === topId)?.position ?? null)
      : null;
    const position = computePosition(null, topPos);
    startTransition(async () => {
      const result = await moveTask({ taskId: task.id, status, position });
      if ("error" in result) toast.error(result.error);
      else onChanged();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Task deleted");
        onChanged();
      }
    });
  }

  return (
    <div
      className={cn(
        // The measured 37px database row (notion-spec-v2 §6); the only rule
        // is the 1px warm divider between rows.
        "group grid min-h-[37px] grid-cols-[24px_1fr_120px_140px_140px_180px_32px] items-center gap-3 border-t border-border px-4 py-1 text-sm",
        "hover:bg-accent",
        selected && "bg-accent-pressed",
        pending && "opacity-60",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggleSelected}
        aria-label={selected ? "Deselect task" : "Select task"}
        className={cn(
          "transition-opacity",
          selected || selectionActive
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100",
        )}
      />
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          indent && "pl-7",
        )}
      >
        {subtaskCount > 0 && onToggleSubtasks ? (
          <button
            type="button"
            onClick={onToggleSubtasks}
            aria-label={
              subtasksExpanded ? "Collapse sub-tasks" : "Expand sub-tasks"
            }
            className="flex shrink-0 items-center gap-0.5 rounded-md px-0.5 text-muted-foreground hover:bg-accent"
          >
            {subtasksExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span className="text-xs tabular-nums">{subtaskCount}</span>
          </button>
        ) : null}
        <Link
          href={taskHref(propertyId, task.id)}
          onClick={handleTitleClick}
          className={cn(
            "truncate font-medium text-foreground hover:underline",
            indent && "text-sm font-normal",
          )}
        >
          {task.title}
        </Link>
      </span>

      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm font-medium",
          priority.textClass,
        )}
      >
        <PriorityBars priority={task.priority} />
        {priority.label}
      </span>

      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-sm tabular-nums",
          due
            ? overdue
              ? "text-destructive"
              : "text-muted-foreground"
            : "text-muted-foreground",
        )}
      >
        {due ? (
          <>
            <CalendarDays className="size-3.5 shrink-0" />
            {formatDate(task.due_at!, now)}
          </>
        ) : (
          "—"
        )}
      </span>

      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {task.assignee_id ? (
          <>
            <Avatar size="sm" className="size-5">
              {assignee?.avatar ? (
                <AvatarImage src={assignee.avatar} alt={assignee.name} />
              ) : null}
              <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
                {initials(assignee?.name ?? "??")}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{assignee?.name ?? "—"}</span>
          </>
        ) : (
          <span className="text-faint-foreground">Unassigned</span>
        )}
      </span>

      <span className="text-sm text-muted-foreground tabular-nums">
        {formatDate(task.updated_at, now)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              disabled={pending}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={c.id === task.status}
                onClick={() => moveTo(c.id)}
              >
                <StatusIcon status={c.id} className="size-3.5" />
                {c.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={remove}
              className="text-destructive focus:text-destructive"
            >
              Delete task
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
