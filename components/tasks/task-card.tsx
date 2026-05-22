"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { MoreHorizontal, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask } from "./actions";
import { COLUMNS, taskShortId, type Task } from "./kanban";
import { StatusIcon } from "./task-icons";
import { PriorityChip } from "./priority-menu";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { TaskStatus } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* FLIP — animates a card sliding to a new position when the board changes    */
/* for a reason *other* than this user's own drag (e.g. a teammate's move).   */
/* dnd-kit owns the animation during an active drag, so FLIP is disabled then.*/
/* -------------------------------------------------------------------------- */

function useFlip<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null);
  const prevRect = useRef<DOMRect | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      prevRect.current = null;
      return;
    }
    const next = el.getBoundingClientRect();
    const prev = prevRect.current;
    prevRect.current = next;
    if (!prev) return;
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const animation = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 0.85, 0.3, 1)" },
    );
    return () => animation.cancel();
  });

  return ref;
}

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

function formatDueDate(due: Date, now: number) {
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > -7 && diffDays < 0) return `${Math.abs(diffDays)}d ago`;
  if (diffDays > 0 && diffDays < 7)
    return due.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = dueDay.getFullYear() === today.getFullYear();
  return due.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/** Absolute "MMM D" / "MMM D, YY" for created timestamps — Linear-style. */
function formatCreated(iso: string, now: number) {
  const d = new Date(iso);
  const today = new Date(now);
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "2-digit" },
  );
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                      */
/* -------------------------------------------------------------------------- */

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function AssigneeSlot({
  info,
  assigneeId,
}: {
  info: AssigneeInfo | undefined;
  assigneeId: string | null;
}) {
  if (!assigneeId) {
    return (
      <span
        aria-label="Unassigned"
        className="inline-flex size-[18px] items-center justify-center text-muted-foreground/40"
      >
        <UserRound className="size-3.5" />
      </span>
    );
  }
  const name = info?.name ?? "Assigned";
  return (
    <Avatar
      size="sm"
      className="size-[18px] shrink-0"
      title={`Assigned to ${name}`}
    >
      {info?.avatar ? <AvatarImage src={info.avatar} alt={name} /> : null}
      <AvatarFallback className="bg-muted text-[0.5625rem] font-medium text-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function CardPropertyRow({
  task,
  onChanged,
}: {
  task: Task;
  onChanged: () => void;
}) {
  // Linear-style "properties" strip — small chips for priority (always
  // present; "No priority" renders as a dashed placeholder) and any other
  // inline properties we add over time. Left-aligned with the task ID so it
  // reads as its own column of metadata, not a continuation of the title.
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <PriorityChip
        taskId={task.id}
        priority={task.priority}
        onChanged={onChanged}
      />
    </div>
  );
}

function CardCreatedAt({ iso, now }: { iso: string | undefined; now: number }) {
  if (!iso) return null;
  return (
    <div className="mt-1.5 text-[0.75rem] leading-4 text-muted-foreground">
      Created {formatCreated(iso, now)}
    </div>
  );
}

function CardDueDate({
  task,
  now,
}: {
  task: Task;
  now: number;
}) {
  const due = task.due_at ? new Date(task.due_at) : null;
  if (!due) return null;
  const overdue = task.status !== "done" && due.getTime() < now;
  return (
    <div
      className={cn(
        "mt-1 text-[0.75rem] leading-4 tabular-nums",
        overdue
          ? "font-medium text-red-600 dark:text-red-400"
          : "text-muted-foreground",
      )}
    >
      Due {formatDueDate(due, now)}
    </div>
  );
}

const CARD_BASE = cn(
  // Padding kept tight (Linear sits around 8px) so the card stays compact
  // even with a priority chip + created date stacked underneath the title.
  "relative rounded-md border border-border/70 bg-card p-2 shadow-xs",
);

/**
 * The card rendered inside the `DragOverlay` — a detached, lifted copy that
 * follows the cursor while the real card stays dimmed in its column.
 */
export function TaskCardOverlay({
  task,
  assignee,
}: {
  task: Task;
  assignee?: AssigneeInfo;
}) {
  const [now] = useState(() => Date.now());
  return (
    <div
      className={cn(
        CARD_BASE,
        "w-72 cursor-grabbing shadow-lg ring-1 ring-black/10 dark:ring-white/10",
      )}
    >
      <CardHeader task={task} assignee={assignee} />
      <CardTitle title={task.title} status={task.status} />
      <CardDescription description={task.description} />
      <CardPropertyRow task={task} onChanged={() => undefined} />
      <CardDueDate task={task} now={now} />
      <CardCreatedAt iso={task.created_at} now={now} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

function CardHeader({
  task,
  assignee,
}: {
  task: Task;
  assignee: AssigneeInfo | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-2 leading-4">
      <span className="text-[0.75rem] font-normal text-muted-foreground tabular-nums tracking-tight">
        {taskShortId(task.id)}
      </span>
      <AssigneeSlot info={assignee} assigneeId={task.assignee_id} />
    </div>
  );
}

function CardTitle({ title, status }: { title: string; status: TaskStatus }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5">
      <span className="flex h-[1.125rem] shrink-0 items-center">
        <StatusIcon status={status} className="size-3.5" />
      </span>
      <p className="line-clamp-2 text-[0.8125rem] leading-[1.125rem] font-normal text-foreground">
        {title}
      </p>
    </div>
  );
}

function CardDescription({ description }: { description: string | null }) {
  const text = description?.trim();
  if (!text) return null;
  return (
    <p className="mt-1 ml-5 line-clamp-1 text-[0.75rem] leading-4 text-muted-foreground/80">
      {text}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Sortable board card                                                        */
/* -------------------------------------------------------------------------- */

type Props = {
  propertyId: string;
  task: Task;
  /** Resolved assignee info from the board-level lookup, if any. */
  assignee?: AssigneeInfo;
  /** True while *any* card is being dragged on this client. */
  dragActive: boolean;
  /** Name of a teammate currently dragging this card, if any. */
  draggedByName: string | null;
  onMove: (taskId: string, status: TaskStatus) => void;
  onChanged: () => void;
};

export function SortableTaskCard({
  propertyId,
  task,
  assignee,
  dragActive,
  draggedByName,
  onMove,
  onChanged,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => Date.now());
  const lockedByOther = draggedByName != null;
  const openTask = useOpenTask(propertyId);

  function handleTitleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openTask(task.id);
  }

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: lockedByOther });

  const flipRef = useFlip<HTMLDivElement>(!dragActive);
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      flipRef.current = node;
    },
    [setNodeRef, flipRef],
  );

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function remove() {
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Task deleted");
        onChanged();
      }
    });
  }

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        CARD_BASE,
        "group outline-none transition-colors",
        // Resting cursor is the default arrow (Linear-style). Only switch to
        // the grabbing hand once the pointer is actively pressed/dragging.
        "active:cursor-grabbing",
        "hover:border-foreground/15",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-40",
        lockedByOther && "cursor-default ring-2 ring-blue-500/50",
      )}
    >
      {lockedByOther ? (
        <div className="absolute -top-2 left-3 rounded-full bg-blue-600 px-2 py-0.5 text-[0.625rem] font-medium text-white shadow-sm">
          {draggedByName} is moving this…
        </div>
      ) : null}

      {/* Hover-only menu — absolutely positioned over the top-right so the
          resting card stays uncluttered like Linear's. The card-colored
          background keeps the trigger readable when it overlays the
          assignee chip. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Task options"
              className={cn(
                "absolute right-1 top-1 z-10 size-6 rounded-sm bg-card p-0 text-muted-foreground/80",
                "opacity-0 transition-opacity",
                "group-hover:opacity-100 focus-visible:opacity-100",
                "aria-expanded:opacity-100 data-popup-open:opacity-100",
                "hover:bg-foreground/8 hover:text-foreground",
              )}
              disabled={pending}
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {COLUMNS.map((c) => (
              <DropdownMenuItem
                key={c.id}
                disabled={c.id === task.status}
                onClick={() => onMove(task.id, c.id)}
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

      <CardHeader task={task} assignee={assignee} />

      <Link
        href={taskHref(propertyId, task.id)}
        onClick={handleTitleClick}
        className="block focus-visible:outline-none"
      >
        <CardTitle title={task.title} status={task.status} />
        <CardDescription description={task.description} />
      </Link>

      <CardPropertyRow task={task} onChanged={onChanged} />
      <CardDueDate task={task} now={now} />
      <CardCreatedAt iso={task.created_at} now={now} />
    </div>
  );
}
