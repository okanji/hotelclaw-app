"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { taskShortId, type Task } from "./kanban";
import { StatusIcon } from "./task-icons";
import { PriorityChip } from "./priority-menu";
import { TaskScopeChips } from "./task-scope-chips";
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
    // Linear's unassigned glyph: a dashed circular hairline ring with a
    // centered person silhouette inside.
    return (
      <span
        aria-label="Unassigned"
        className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60"
      >
        <UserRound className="size-3" strokeWidth={1.75} />
      </span>
    );
  }
  const name = info?.name ?? "Assigned";
  return (
    <Avatar
      size="sm"
      className="size-[22px] shrink-0"
      title={`Assigned to ${name}`}
    >
      {info?.avatar ? <AvatarImage src={info.avatar} alt={name} /> : null}
      <AvatarFallback className="bg-muted text-[0.625rem] font-medium text-foreground">
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
  // Linear-style "properties" strip — the priority glyph rendered bare
  // (no chip border) so it reads as inline metadata rather than its own
  // affordance. Other inline properties (labels, due-date pill, etc.)
  // can be appended here over time.
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1">
      <PriorityChip
        taskId={task.id}
        priority={task.priority}
        onChanged={onChanged}
        appearance="bare"
      />
      <TaskScopeChips task={task} />
    </div>
  );
}

function CardCreatedAt({ iso, now }: { iso: string | undefined; now: number }) {
  if (!iso) return null;
  return (
    <div className="mt-2.5 text-[0.75rem] leading-4 text-muted-foreground">
      Created {formatCreated(iso, now)}
    </div>
  );
}

const CARD_BASE = cn(
  // Roomy padding (Linear sits ~12px) so the ID row, title, priority, and
  // created-date each have their own breathing room.
  "relative rounded-md border border-border/70 bg-card p-3 shadow-xs",
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
      <CardPropertyRow task={task} onChanged={() => undefined} />
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
    <div className="mt-2.5 flex items-start gap-1.5">
      <span className="flex h-4.5 shrink-0 items-center">
        <StatusIcon status={status} className="size-3.5" />
      </span>
      <p className="line-clamp-2 text-[0.8125rem] leading-4.5 font-medium text-foreground">
        {title}
      </p>
    </div>
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
  onChanged: () => void;
};

export function SortableTaskCard({
  propertyId,
  task,
  assignee,
  dragActive,
  draggedByName,
  onChanged,
}: Props) {
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

      <CardHeader task={task} assignee={assignee} />

      <Link
        href={taskHref(propertyId, task.id)}
        onClick={handleTitleClick}
        className="block focus-visible:outline-none"
      >
        <CardTitle title={task.title} status={task.status} />
      </Link>

      <CardPropertyRow task={task} onChanged={onChanged} />
      <CardCreatedAt iso={task.created_at} now={now} />
    </div>
  );
}
