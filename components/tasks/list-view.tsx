"use client";

import { useMemo, useState, useTransition } from "react";
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
import { deleteTask, moveTask } from "./actions";
import {
  COLUMNS,
  PRIORITY_META,
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
  assignees,
  hideDone,
  onChanged,
  onOpenFullCreate,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<TaskStatus, boolean>>({
    todo: false,
    in_progress: false,
    blocked: false,
    done: false,
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
      <div className="sticky top-0 z-10 grid grid-cols-[1fr_120px_140px_140px_180px_32px] items-center gap-3 border-b border-border bg-background/95 px-4 py-2 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">
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
            <header className="flex items-center gap-2 bg-muted/30 px-4 py-1.5">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((p) => ({ ...p, [status]: !p[status] }))
                }
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${col.label}`}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </button>
              <StatusIcon status={col.id} className="size-3.5" />
              <h3 className="text-[0.8125rem] font-medium tracking-tight text-foreground">
                {col.label}
              </h3>
              <span className="text-[0.75rem] tabular-nums tracking-tight text-muted-foreground">
                {rows.length}
              </span>
              <button
                type="button"
                onClick={() => onOpenFullCreate(status)}
                className="ml-auto inline-flex h-6 items-center gap-1 rounded px-1.5 text-[0.6875rem] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3" />
                New
              </button>
            </header>

            {!isCollapsed ? (
              rows.length === 0 ? (
                <div className="px-6 py-4 text-xs text-muted-foreground">
                  No tasks in this status.
                </div>
              ) : (
                rows.map((task) => (
                  <ListRow
                    key={task.id}
                    propertyId={propertyId}
                    task={task}
                    assignee={
                      task.assignee_id ? assignees[task.assignee_id] : undefined
                    }
                    grouped={grouped}
                    onChanged={onChanged}
                  />
                ))
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ListRow({
  propertyId,
  task,
  assignee,
  grouped,
  onChanged,
}: {
  propertyId: string;
  task: Task;
  assignee: AssigneeInfo | undefined;
  grouped: Record<TaskStatus, Task[]>;
  onChanged: () => void;
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
        "group grid grid-cols-[1fr_120px_140px_140px_180px_32px] items-center gap-3 border-t border-border/40 px-4 py-2 text-sm",
        "hover:bg-muted/40",
        pending && "opacity-60",
      )}
    >
      <Link
        href={taskHref(propertyId, task.id)}
        onClick={handleTitleClick}
        className="truncate font-medium text-foreground hover:underline"
      >
        {task.title}
      </Link>

      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium",
          priority.textClass,
        )}
      >
        <PriorityBars priority={task.priority} />
        {priority.label}
      </span>

      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs tabular-nums",
          due
            ? overdue
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
            : "text-muted-foreground/50",
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

      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {task.assignee_id ? (
          <>
            <Avatar size="sm" className="size-5">
              {assignee?.avatar ? (
                <AvatarImage src={assignee.avatar} alt={assignee.name} />
              ) : null}
              <AvatarFallback className="bg-muted text-[10px] font-medium text-foreground">
                {initials(assignee?.name ?? "??")}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{assignee?.name ?? "—"}</span>
          </>
        ) : (
          <span className="text-muted-foreground/50">Unassigned</span>
        )}
      </span>

      <span className="text-xs text-muted-foreground tabular-nums">
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
