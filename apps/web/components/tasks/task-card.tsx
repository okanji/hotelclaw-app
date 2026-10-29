"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import {
  Calendar,
  Check,
  ListChecks,
  Pencil,
  Repeat,
  RotateCcw,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Gi } from "@/components/gr8r/icon";
import { Av, AvStack, ProgBar } from "@/components/gr8r/home-glyphs";
import {
  G8StatusIcon,
  cVar,
  dayDiff,
  g8Color,
  relDate,
  startOfDay,
} from "@/components/gr8r/my-tasks-glyphs";
import { taskAssigneeIds } from "@/lib/tasks/assignees";
import { isDone } from "@/lib/tasks/statuses";
import { optionColor } from "@/lib/tasks/custom-field-options";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";
import { useAssigneesMapContext } from "@/lib/tasks/use-assignees";
import { taskKey, type Task } from "./kanban";
import { updateTask } from "./actions";
import { WorkflowProvenanceBadge } from "@/components/workflows/provenance-badge";
import { PriorityChip } from "./priority-menu";
import { taskHref } from "@/lib/tasks/task-href";
import { useOpenTask } from "@/lib/tasks/use-open-task";
import type { AssigneeInfo } from "@/lib/tasks/use-assignees";
import type { CustomFieldOption, StatusCategory } from "@/lib/db/types";

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
/* gr8r card pieces (src/views/board.js `kcard`)                              */
/* -------------------------------------------------------------------------- */

/** Absolute "MMM D" / "MMM D, YY" for created timestamps. */
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

/** The task's status category — the 0114 row fields, else the legacy literal. */
function categoryOf(task: Task): { category: StatusCategory; blocked: boolean } {
  if (task.status_category)
    return { category: task.status_category, blocked: Boolean(task.status_blocked) };
  switch (task.status) {
    case "done":
      return { category: "closed", blocked: false };
    case "in_progress":
      return { category: "active", blocked: false };
    case "blocked":
      return { category: "active", blocked: true };
    default:
      return { category: "open", blocked: false };
  }
}

const RECURRENCE_NAME: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  biweekly: "every two weeks",
  monthly: "monthly",
};

/**
 * gr8r `.labels`: the task's team + project (a `.lbl` with its colour
 * pip — our scope chips) then its label-field options, resolved board-level
 * so a label looks identical across views.
 */
function CardLabels({
  task,
  labels,
}: {
  task: Task;
  labels: CustomFieldOption[] | undefined;
}) {
  const pathname = usePathname();
  const propertyId = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? "";
  const { data: spaces = [] } = useQuery({
    ...spacesQueryOptions(propertyId),
    enabled: !!propertyId && !!task.space_id,
  });
  const { data: projects = [] } = useQuery({
    ...projectsQueryOptions(propertyId),
    enabled: !!propertyId && !!task.project_id,
  });
  const space = task.space_id ? spaces.find((x) => x.id === task.space_id) : null;
  const project = task.project_id
    ? projects.find((x) => x.id === task.project_id)
    : null;
  if (!space && !project && !labels?.length) return null;
  return (
    <div className="labels">
      {space ? (
        <span className="lbl" title={`Team: ${space.name}`}>
          <i style={cVar(g8Color(space.color))} />
          <span className="truncate" style={{ maxWidth: 110 }}>{space.name}</span>
        </span>
      ) : null}
      {project ? (
        <span className="lbl" title={`Project: ${project.name}`}>
          <i style={cVar(g8Color(project.color))} />
          <span className="truncate" style={{ maxWidth: 110 }}>{project.name}</span>
        </span>
      ) : null}
      {labels?.map((o) => (
        <span key={o.id} className="lbl">
          <i style={cVar(g8Color(optionColor(o)))} />
          <span className="truncate" style={{ maxWidth: 110 }}>{o.label}</span>
        </span>
      ))}
    </div>
  );
}

/** gr8r `.avs` over every assignee (0115), primary first; empty = dashed. */
function CardAssignees({
  info,
  task,
}: {
  info: AssigneeInfo | undefined;
  task: Task;
}) {
  const shared = useAssigneesMapContext();
  const ids = taskAssigneeIds(task);
  const infos =
    info && task.assignee_id ? { ...shared, [task.assignee_id]: info } : shared;
  if (ids.length === 0) return <Av member={null} />;
  return (
    <AvStack
      max={3}
      members={ids.map((id) => ({
        id,
        name: infos[id]?.name ?? "Member",
        avatarUrl: infos[id]?.avatar ?? null,
      }))}
    />
  );
}

function CardBody({
  task,
  assignee,
  labels,
  onChanged,
  now,
  titleSlot,
}: {
  task: Task;
  assignee: AssigneeInfo | undefined;
  labels: CustomFieldOption[] | undefined;
  onChanged: () => void;
  now: number;
  /** The title, wrapped in the task link on the live card. */
  titleSlot: (title: React.ReactNode) => React.ReactNode;
}) {
  const { category, blocked } = categoryOf(task);
  const today = startOfDay(now);
  const dueIn = task.due_at ? dayDiff(task.due_at, today) : null;
  const done = isDone(task);
  const total = task.checklist_total ?? 0;
  const ticked = task.checklist_done ?? 0;
  return (
    <>
      <CardLabels task={task} labels={labels} />
      <div className="top">
        <span style={{ margin: "2px 7px 0 0", display: "inline-flex" }}>
          <G8StatusIcon
            category={category}
            blocked={blocked}
            color={task.status_color}
          />
        </span>
        {titleSlot(<div className="title">{task.title}</div>)}
      </div>
      {total > 0 ? (
        // gr8r's sub-task progress row, fed by the 0117 checklist counters.
        <div
          className="subp"
          title={`${ticked} of ${total} checklist items done`}
        >
          <Gi icon={ListChecks} size={12} />
          <span className="num">
            {ticked}/{total}
          </span>
          <ProgBar
            value={Math.round((ticked / total) * 100)}
            tone={ticked >= total ? "green" : ""}
          />
        </div>
      ) : null}
      <div className="meta">
        <span
          className="key"
          title={task.created_at ? `Created ${formatCreated(task.created_at, now)}` : undefined}
        >
          {taskKey(task)}
        </span>
        <WorkflowProvenanceBadge source={task.source} appearance="glyph" />
        <span className="m">
          <PriorityChip
            taskId={task.id}
            priority={task.priority}
            onChanged={onChanged}
            appearance="bare"
          />
        </span>
        {task.due_at && dueIn !== null ? (
          <span
            className={cn(
              "m due",
              !done && dueIn < 0 && "over",
              !done && dueIn >= 0 && dueIn <= 1 && "soon",
            )}
            title={`Due ${new Date(task.due_at).toLocaleDateString()}`}
          >
            <Gi icon={Calendar} size={12} />
            {relDate(task.due_at, today)}
          </span>
        ) : null}
        {task.recurrence ? (
          <span
            className="m"
            title={`Repeats ${RECURRENCE_NAME[task.recurrence] ?? task.recurrence}`}
          >
            <Gi icon={Repeat} size={12} />
          </span>
        ) : null}
        {task.estimate != null ? (
          <span
            className="m num"
            title={`Estimate: ${task.estimate} ${task.estimate === 1 ? "point" : "points"}`}
          >
            <Gi icon={Timer} size={12} />
            {task.estimate}
          </span>
        ) : null}
        <span className="m" style={{ marginLeft: "auto" }}>
          <CardAssignees info={assignee} task={task} />
        </span>
      </div>
    </>
  );
}

/**
 * The card rendered inside the `DragOverlay` — gr8r's `.kcard.ghost`, a
 * lifted, slightly tilted copy that follows the cursor while the real card
 * stays dimmed in its column. `w-full`: dnd-kit sizes the overlay wrapper to
 * the source card's measured rect.
 */
export function TaskCardOverlay({
  task,
  assignee,
  labels,
  lifted = true,
}: {
  task: Task;
  assignee?: AssigneeInfo;
  labels?: CustomFieldOption[];
  /** false = a resting card (the grouped board draws its cards with this). */
  lifted?: boolean;
}) {
  const [now] = useState(() => Date.now());
  return (
    <div className={cn("kcard w-full", lifted && "ghost", isDone(task) && "done")}>
      <CardBody
        task={task}
        assignee={assignee}
        labels={labels}
        onChanged={() => undefined}
        now={now}
        titleSlot={(t) => t}
      />
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
  /** Where "Mark complete" sends the task — the board's closed status. */
  doneTarget?: string;
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
  doneTarget = "done",
}: Props) {
  const [now] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const lockedByOther = draggedByName != null;
  const openTask = useOpenTask(propertyId);
  const done = isDone(task);

  function handleTitleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openTask(task.id);
  }

  // gr8r's hover "Mark complete / Reopen". A legacy literal is resolved to
  // the task's own list pipeline by the DB (0114), so "todo" reopens into
  // the list's open status.
  function toggleDone() {
    startTransition(async () => {
      const res = await updateTask({
        taskId: task.id,
        status: done ? "todo" : doneTarget,
      });
      if ("error" in res) toast.error(res.error);
      else onChanged();
    });
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
    ...(lockedByOther
      ? { boxShadow: "0 0 0 2px var(--g8-blue)", cursor: "default" }
      : null),
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "kcard",
        // Offscreen cards skip paint (content-visibility) and reserve their
        // last-seen height (`auto`), so a long column never reflows mid-drag
        // — dnd-kit measures droppables once per drag. Requires the BLOCK
        // `.bcol-b.is-block` scroller (see kanban-column.tsx). Paint
        // containment clips children to the card: nothing may hang outside.
        "[content-visibility:auto] [contain-intrinsic-size:auto_6.5rem]",
        "outline-none focus-visible:shadow-focus active:cursor-grabbing",
        done && "done",
        isDragging && "dragging",
        pending && "opacity-60",
      )}
    >
      {lockedByOther ? (
        <div
          className="badge accent"
          style={{ position: "absolute", top: 6, left: 8, zIndex: 1 }}
        >
          {draggedByName} is moving this…
        </div>
      ) : null}

      <CardBody
        task={task}
        assignee={assignee}
        labels={labels}
        onChanged={onChanged}
        now={now}
        titleSlot={(title) => (
          <Link
            href={taskHref(propertyId, task.id)}
            onClick={handleTitleClick}
            className="block min-w-0 flex-1 focus-visible:outline-none"
            style={{ color: "inherit" }}
          >
            {title}
          </Link>
        )}
      />

      <div className="hacts" onPointerDown={stop}>
        <button
          type="button"
          className="ibtn ibtn-xs"
          onClick={(e) => {
            e.stopPropagation();
            toggleDone();
          }}
          disabled={pending}
          title={done ? "Reopen" : "Mark complete"}
          aria-label={done ? "Reopen" : "Mark complete"}
        >
          <Gi icon={done ? RotateCcw : Check} size={13} />
        </button>
        <button
          type="button"
          className="ibtn ibtn-xs"
          onClick={(e) => {
            e.stopPropagation();
            openTask(task.id);
          }}
          title="Open"
          aria-label="Open task"
        >
          <Gi icon={Pencil} size={12} />
        </button>
      </div>
    </div>
  );
});
