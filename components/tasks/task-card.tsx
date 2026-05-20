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
import { CalendarDays, GripVertical, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deleteTask } from "./actions";
import { COLUMNS, PRIORITY_META, type Task } from "./kanban";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
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
      // A drag is in progress — let dnd-kit drive every transform.
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
/* Presentational pieces                                                      */
/* -------------------------------------------------------------------------- */

function TaskMeta({ task }: { task: Task }) {
  // Snapshot "now" once per mount — a task board doesn't need the overdue
  // flag to tick live, and this keeps the render pure.
  const [now] = useState(() => Date.now());
  const priority = PRIORITY_META[task.priority];
  const due = task.due_at ? new Date(task.due_at) : null;
  const overdue =
    due != null && task.status !== "done" && due.getTime() < now;

  return (
    <div className="mt-3 flex items-center gap-3 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-medium",
          priority.textClass,
        )}
      >
        <span className={cn("size-1.5 rounded-full", priority.dotClass)} />
        {priority.label}
      </span>
      {due ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 tabular-nums",
            overdue
              ? "font-medium text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3.5" />
          {due.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      ) : null}
    </div>
  );
}

const CARD_BASE =
  "rounded-lg border border-border bg-card p-3 shadow-xs";

/**
 * The card rendered inside the `DragOverlay` — a detached, lifted copy that
 * follows the cursor while the real card stays dimmed in its column.
 */
export function TaskCardOverlay({ task }: { task: Task }) {
  return (
    <div
      className={cn(
        CARD_BASE,
        "w-full cursor-grabbing shadow-xl ring-1 ring-black/5",
      )}
    >
      <p className="pr-6 text-sm/5 font-medium text-foreground">{task.title}</p>
      <TaskMeta task={task} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sortable board card                                                        */
/* -------------------------------------------------------------------------- */

type Props = {
  propertyId: string;
  task: Task;
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
  dragActive,
  draggedByName,
  onMove,
  onChanged,
}: Props) {
  const [pending, startTransition] = useTransition();
  const lockedByOther = draggedByName != null;
  const openTask = useOpenTask(propertyId);

  // Plain left-click → client-side `pushState` switch (no route nav, no
  // `TaskDetailSkeleton` flash). Modified clicks fall through to the browser
  // so "open in new tab" still works via the underlying `<a href>`.
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
        "group relative outline-none",
        "cursor-grab active:cursor-grabbing",
        "hover:border-foreground/20",
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

      <div className="flex items-start justify-between gap-2">
        {/* Draggable like the rest of the card; a plain click (no drag)
            still navigates to the task detail page. */}
        <Link
          href={taskHref(propertyId, task.id)}
          onClick={handleTitleClick}
          className="text-sm/5 font-medium text-foreground hover:underline"
        >
          {task.title}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                onPointerDown={(e) => e.stopPropagation()}
                className="-mt-1 -mr-1 size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
                  onClick={() => onMove(task.id, c.id)}
                >
                  <span className={cn("size-2 rounded-full", c.dotClass)} />
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

      <TaskMeta task={task} />

      <GripVertical
        aria-hidden
        className="absolute top-1/2 -left-0.5 size-4 -translate-y-1/2 text-muted-foreground/40 opacity-0 group-hover:opacity-100"
      />
    </div>
  );
}
