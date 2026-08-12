"use client";

import {
  memo,
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
import { WorkflowProvenanceBadge } from "@/components/workflows/provenance-badge";
import { StatusIcon } from "./task-icons";
import { PriorityChip } from "./priority-menu";
import { TaskScopeChips } from "./task-scope-chips";
import { OptionChip } from "./custom-field-chip";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption, TaskStatus } from "@/lib/db/types";

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
        // The dashed ring here is a GLYPH standing in for an avatar, not a
        // "dashed grey box" container — it is the only dashed stroke left in
        // this surface and it earns its place by reading as an empty slot.
        className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground"
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
      <AvatarFallback className="bg-muted text-xs font-medium text-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function CardPropertyRow({
  task,
  labels,
  onChanged,
}: {
  task: Task;
  labels: CustomFieldOption[] | undefined;
  onChanged: () => void;
}) {
  // Linear-style "properties" strip — the priority glyph rendered bare
  // (no chip border) so it reads as inline metadata rather than its own
  // affordance. `labels` are the task's label-field (multi_select custom
  // field) options, resolved board-level — same chips the list view cells
  // draw, so a label looks identical across views.
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1">
      <PriorityChip
        taskId={task.id}
        priority={task.priority}
        onChanged={onChanged}
        appearance="bare"
      />
      <TaskScopeChips task={task} />
      {labels?.map((o) => <OptionChip key={o.id} option={o} />)}
    </div>
  );
}

function CardCreatedAt({ iso, now }: { iso: string | undefined; now: number }) {
  if (!iso) return null;
  return (
    <div className="mt-2.5 text-xs leading-4 text-muted-foreground">
      Created {formatCreated(iso, now)}
    </div>
  );
}

const CARD_BASE = cn(
  // A board card IS a page (notion-spec-v2 §5): the 10px `rounded-card` rung
  // and the `shadow-card` tier — one very soft far layer whose LAST layer is
  // the 1px warm ring. It used to be `rounded-md shadow-ring`, which is the
  // recipe for a WELL, and that is why the cards read as list rows sitting in
  // a grey trough rather than as pages floating on the page plane.
  // Measured padding is `8px 10px`.
  "relative rounded-card bg-card px-2.5 py-2 shadow-card",
  // Offscreen cards skip paint entirely (content-visibility). On a full
  // board the columns are thousands of px tall; painting all of it into
  // Chrome's composited scroller textures is what pushed macOS GPU
  // rasterization over the edge (cards/header going white until a scroll
  // re-rasters). `contain-intrinsic-size` reserves the space a skipped card
  // would have taken; `auto` then remembers its real size, so a card that
  // has been seen once holds its exact height forever after and the column
  // never reflows as you scroll. That stability is what dnd-kit's geometry
  // rests on — it measures every droppable ONCE per drag and afterwards only
  // offsets those rects by the scroll delta, so any reflow mid-drag puts the
  // drop somewhere other than the cursor.
  //
  // REQUIRES the card's scroll container to be BLOCK, not flex — Chrome
  // silently ignores `contain-intrinsic-size` on a flex item and collapses
  // it to 26px of padding. See the comment in `kanban-column.tsx`.
  //
  // NB: the paint containment this implies clips children to the card's
  // bounds — nothing inside a card may hang outside it.
  //
  // 8rem is the CONTENT box (the card adds 26px of padding + border on top),
  // putting a never-yet-rendered card at ~154px against a real 134–176px —
  // i.e. within ~24px. It only ever applies until a card has been seen once;
  // after that `auto` pins it to its exact remembered height.
  "[content-visibility:auto] [contain-intrinsic-size:auto_8rem]",
);

/**
 * The card rendered inside the `DragOverlay` — a detached, lifted copy that
 * follows the cursor while the real card stays dimmed in its column.
 *
 * `w-full`, never a fixed width: dnd-kit sizes the overlay wrapper to the
 * source card's measured rect (272px in a kanban column, 276px in the grouped
 * view), so a hardcoded `w-72` (288px) made the ghost overhang its own
 * wrapper by 12–16px.
 */
export function TaskCardOverlay({
  task,
  assignee,
  labels,
}: {
  task: Task;
  assignee?: AssigneeInfo;
  labels?: CustomFieldOption[];
}) {
  const [now] = useState(() => Date.now());
  return (
    <div
      className={cn(
        CARD_BASE,
        "w-full cursor-grabbing shadow-overlay",
      )}
    >
      <CardHeader task={task} assignee={assignee} />
      <CardTitle title={task.title} status={task.status} />
      <CardPropertyRow task={task} labels={labels} onChanged={() => undefined} />
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
      <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground tabular-nums">
        {taskShortId(task.id)}
        <WorkflowProvenanceBadge source={task.source} appearance="glyph" />
      </span>
      <AssigneeSlot info={assignee} assigneeId={task.assignee_id} />
    </div>
  );
}

function CardTitle({ title, status }: { title: string; status: TaskStatus }) {
  return (
    // A database card's title is CONTENT, not a UI label — 16px / 24px weight
    // 400 (notion-spec-v2 §2). v1 flattened it to `text-sm font-medium`, which
    // is the sidebar-row rung, and that single decision is what made every
    // card read as a list row instead of as a page.
    <div className="mt-2 flex items-start gap-1.5">
      <span className="flex h-6 shrink-0 items-center">
        <StatusIcon status={status} className="size-3.5" />
      </span>
      <p className="line-clamp-3 text-base leading-6 font-normal text-foreground">
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
  /** Label-field chips from the board-level lookup, if any. */
  labels?: CustomFieldOption[];
  /** True while *any* card is being dragged on this client. */
  dragActive: boolean;
  /** Name of a teammate currently dragging this card, if any. */
  draggedByName: string | null;
  onChanged: () => void;
};

/**
 * Memoized: on a full board a single board-level re-render (presence
 * change, refetch, column collapse) otherwise re-renders every card —
 * including each card's per-card query hooks. Props are stable between
 * board renders except when a card's own data changes.
 */
export const SortableTaskCard = memo(function SortableTaskCard({
  propertyId,
  task,
  assignee,
  labels,
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
        "focus-visible:shadow-focus",
        isDragging && "opacity-40",
        lockedByOther && "cursor-default ring-2 ring-info/50",
      )}
    >
      {lockedByOther ? (
        // Sits inside the card (not overlapping its top edge): CARD_BASE's
        // content-visibility implies paint containment, which clips children
        // to the card bounds.
        <div className="absolute top-1.5 left-2 rounded-md bg-info px-2 py-0.5 text-xs font-medium text-background">
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

      <CardPropertyRow task={task} labels={labels} onChanged={onChanged} />
      <CardCreatedAt iso={task.created_at} now={now} />
    </div>
  );
});
