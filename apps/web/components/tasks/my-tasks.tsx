"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import type { MessageResponse } from "stream-chat";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDashed,
  GripVertical,
  Play,
  Sparkles,
} from "lucide-react";
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
import { PortalDragOverlay } from "@/components/ui/portal-drag-overlay";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  tasksQueryOptions,
  propertyMembersQueryOptions,
  mentionsQueryOptions,
} from "@/lib/query/section-queries";
import { taskHref } from "@/lib/tasks/task-href";
import { MentionRow } from "@/components/chat/inbox/mention-row";
import { ShiftBriefWidget } from "@/components/home/widgets/shift-brief-widget";
import { updateTask } from "./actions";
import { PRIORITY_META, type Task } from "./kanban";

/**
 * My Tasks — the personal agenda, deliberately NOT another board. The board
 * answers "what state is the team's work in"; this page answers "what
 * should I do next": the shift brief on top, work grouped by when it's due
 * (overdue → today → this week → later) with drag-to-reschedule between
 * groups, blocked items pulled out, one-click done/start, replies you owe
 * from chat, and a follow-up lens the board doesn't have — tasks you handed
 * to others.
 */

const DAY = 24 * 60 * 60 * 1000;

/** The schedulable agenda groups — each is a drop target that sets due_at. */
const SCHEDULE_BUCKETS = [
  { id: "today", label: "Today", hint: "due today" },
  { id: "week", label: "This week", hint: "due tomorrow" },
  { id: "later", label: "Later", hint: "due next week" },
  { id: "nodate", label: "No due date", hint: "clears the due date" },
] as const;
type ScheduleBucketId = (typeof SCHEDULE_BUCKETS)[number]["id"];

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** due_at an agenda drop assigns — end of working day, local time. */
function dueAtForBucket(bucket: ScheduleBucketId): string | null {
  if (bucket === "nodate") return null;
  const offsetDays = bucket === "today" ? 0 : bucket === "week" ? 1 : 7;
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
}

export function MyTasks({
  propertyId,
  userId,
  firstName,
}: {
  propertyId: string;
  userId: string;
  firstName: string | null;
}) {
  const qc = useQueryClient();
  const { client } = useChatContext();
  const { data: tasks = [], isPending } = useQuery(tasksQueryOptions(propertyId));
  const { data: members = [] } = useQuery(propertyMembersQueryOptions(propertyId));
  const { data: mentionHits = [] } = useQuery(
    mentionsQueryOptions(propertyId, userId, client),
  );
  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.name ?? "Someone"])),
    [members],
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // Stable per mount — keeps derived bucket math referentially consistent
  // for the React Compiler and avoids impure Date calls during render.
  const [now] = useState(() => new Date());
  const today = startOfDay(now);

  const { byBucket, overdue, blocked, delegated, doneThisWeek, openCount, dueTodayCount } =
    useMemo(() => {
      const mine = tasks.filter((t) => t.assignee_id === userId && !t.parent_id);
      const open = mine.filter((t) => t.status !== "done");
      const blockedTasks = open.filter((t) => t.status === "blocked");
      const actionable = open.filter((t) => t.status !== "blocked");

      const groups: Record<ScheduleBucketId, Task[]> = {
        today: [],
        week: [],
        later: [],
        nodate: [],
      };
      const overdueTasks: Task[] = [];
      for (const t of actionable) {
        if (!t.due_at) {
          groups.nodate.push(t);
          continue;
        }
        const due = startOfDay(new Date(t.due_at));
        if (due < today) overdueTasks.push(t);
        else if (due === today) groups.today.push(t);
        else if (due < today + 7 * DAY) groups.week.push(t);
        else groups.later.push(t);
      }
      const byDue = (a: Task, b: Task) =>
        (a.due_at ?? "").localeCompare(b.due_at ?? "") ||
        PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order;
      const byPriority = (a: Task, b: Task) =>
        PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order;
      overdueTasks.sort(byDue);
      groups.today.sort(byPriority);
      groups.week.sort(byDue);
      groups.later.sort(byDue);
      groups.nodate.sort(byPriority);

      const delegatedTasks = tasks
        .filter(
          (t) =>
            t.created_by === userId &&
            t.assignee_id &&
            t.assignee_id !== userId &&
            t.status !== "done" &&
            !t.parent_id,
        )
        .sort(byDue);

      const weekAgo = now.getTime() - 7 * DAY;
      const recentDone = mine.filter(
        (t) => t.status === "done" && new Date(t.updated_at).getTime() >= weekAgo,
      );

      return {
        byBucket: groups,
        overdue: overdueTasks,
        blocked: blockedTasks,
        delegated: delegatedTasks,
        doneThisWeek: recentDone.length,
        openCount: open.length,
        dueTodayCount: overdueTasks.length + groups.today.length,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks, userId, today]);

  // Replies owed: where you were @-mentioned in the last 7 days, by someone
  // else. (Whether you've answered isn't knowable cheaply — recency keeps it
  // honest.) Capped; the inbox has the full list.
  const recentMentions = useMemo(() => {
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

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const bucket = over.id as ScheduleBucketId;
    if (!SCHEDULE_BUCKETS.some((b) => b.id === bucket)) return;
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const dueAt = dueAtForBucket(bucket);
    // No-op when dropping back into the same group.
    if (dueAt === null && !task.due_at) return;
    void updateTask({ taskId: task.id, dueAt }).then((result) => {
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    });
  }

  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : null;

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLine = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <header>
        <p className="text-sm text-muted-foreground">{dateLine}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">
          {greeting}
          {firstName ? `, ${firstName.split(" ")[0]}` : ""}
        </h1>
      </header>

      {/* Personal pulse — whitespace-separated stats, no card chrome. */}
      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="To act on today" value={dueTodayCount} emphasize={dueTodayCount > 0} />
        <Stat label="Open" value={openCount} />
        <Stat label="Blocked" value={blocked.length} emphasize={blocked.length > 0} amber />
        <Stat label="Done this week" value={doneThisWeek} />
      </div>

      {/* Since your last shift — the existing brief, same payload as Home. */}
      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          Since your last shift
        </h2>
        <div className="mt-2 rounded-xl border border-border/70 p-4">
          <ShiftBriefWidget propertyId={propertyId} />
        </div>
      </section>

      {isPending ? (
        <p className="mt-12 text-sm text-muted-foreground">Loading your tasks…</p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setDraggingId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <div className="mt-10 flex flex-col gap-10">
            {blocked.length > 0 ? (
              <section>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                  <AlertTriangle className="size-4 shrink-0" />
                  Blocked — needs unsticking
                </h2>
                <div className="mt-2 flex flex-col">
                  {blocked.map((t) => (
                    <TaskRow key={t.id} task={t} propertyId={propertyId} today={today} />
                  ))}
                </div>
              </section>
            ) : null}

            {overdue.length > 0 ? (
              <section>
                <h2 className="flex items-baseline gap-2 text-sm font-semibold text-destructive">
                  Overdue
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {overdue.length}
                  </span>
                </h2>
                <div className="mt-2 flex flex-col">
                  {overdue.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      propertyId={propertyId}
                      today={today}
                      draggable
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {SCHEDULE_BUCKETS.map((bucket) => (
              <DroppableBucket
                key={bucket.id}
                bucket={bucket}
                tasks={byBucket[bucket.id]}
                dragging={draggingId !== null}
              >
                {byBucket[bucket.id].map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    propertyId={propertyId}
                    today={today}
                    draggable
                  />
                ))}
              </DroppableBucket>
            ))}

            {recentMentions.length > 0 ? (
              <section>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <AtSign className="size-4 shrink-0 text-muted-foreground" />
                  Replies owed
                  <Link
                    href={`/p/${propertyId}/inbox`}
                    className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground"
                  >
                    All mentions
                  </Link>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Where you were @-mentioned this week.
                </p>
                <ul className="mt-2 space-y-2" role="list">
                  {recentMentions.map((m) => (
                    <MentionRow key={m.id} propertyId={propertyId} message={m} />
                  ))}
                </ul>
              </section>
            ) : null}

            {delegated.length > 0 ? (
              <section>
                <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                  Waiting on others
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {delegated.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tasks you created and handed off — still open.
                </p>
                <div className="mt-2 flex flex-col">
                  {delegated.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      propertyId={propertyId}
                      today={today}
                      assigneeName={t.assignee_id ? memberName.get(t.assignee_id) : undefined}
                      readOnly
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {openCount === 0 && delegated.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Check className="size-8 text-success" />
                <p className="text-sm font-medium">All clear</p>
                <p className="max-w-[36ch] text-sm text-pretty text-muted-foreground">
                  Nothing assigned to you right now. Anything new lands here the
                  moment it&apos;s yours.
                </p>
              </div>
            ) : null}
          </div>

          <PortalDragOverlay>
            {draggingTask ? (
              <div className="w-fit max-w-xs truncate rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-md ring-1 ring-black/5">
                {draggingTask.title}
              </div>
            ) : null}
          </PortalDragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/**
 * An agenda group that doubles as a drop target — dropping a row here
 * reschedules it (Today → due today, This week → tomorrow, Later → next
 * week, No due date → cleared). Empty groups stay mounted so there's always
 * somewhere to drop.
 */
function DroppableBucket({
  bucket,
  tasks,
  dragging,
  children,
}: {
  bucket: (typeof SCHEDULE_BUCKETS)[number];
  tasks: Task[];
  dragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket.id });

  if (tasks.length === 0 && !dragging) return null;

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "-mx-3 rounded-lg px-3 py-1 transition-colors",
        isOver && "bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {bucket.label}
        <span className="text-xs font-normal tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
        {dragging ? (
          <span className="text-xs font-normal text-muted-foreground">
            drop → {bucket.hint}
          </span>
        ) : null}
      </h2>
      <div className="mt-2 flex flex-col">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
            Drop a task here
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  emphasize = false,
  amber = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
  amber?: boolean;
}) {
  return (
    <div>
      <p
        className={cn(
          "text-xl font-semibold tracking-tight tabular-nums",
          emphasize && (amber ? "text-warning" : "text-destructive"),
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * One agenda row — drag handle (reschedule), done-toggle, priority dot,
 * title link, context, due chip, and a hover "Start" for queued work.
 * `readOnly` (the delegated lens) swaps the toggle for the assignee's name.
 */
function TaskRow({
  task,
  propertyId,
  today,
  assigneeName,
  readOnly = false,
  draggable = false,
}: {
  task: Task;
  propertyId: string;
  today: number;
  assigneeName?: string;
  readOnly?: boolean;
  draggable?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, startTransition] = useTransition();
  const [justDone, setJustDone] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable,
  });

  function setStatus(status: "done" | "in_progress") {
    startTransition(async () => {
      if (status === "done") setJustDone(true);
      const result = await updateTask({ taskId: task.id, status });
      if ("error" in result) {
        setJustDone(false);
        toast.error(result.error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    });
  }

  const due = task.due_at ? new Date(task.due_at) : null;
  const dueStart = due ? startOfDay(due) : null;
  const dueLabel = !due
    ? null
    : dueStart === today
      ? "Today"
      : dueStart === today + DAY
        ? "Tomorrow"
        : due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const overdue = dueStart !== null && dueStart < today && task.status !== "done";
  const priority = PRIORITY_META[task.priority];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5",
        "hover:bg-muted/50",
        justDone && "opacity-40",
        isDragging && "opacity-40",
      )}
    >
      {draggable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reschedule "${task.title}" by dragging`}
          className="-ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : null}

      {readOnly ? (
        <CircleDashed className="size-4 shrink-0 text-muted-foreground/50" />
      ) : (
        <button
          type="button"
          aria-label={`Mark "${task.title}" done`}
          disabled={busy || justDone}
          onClick={() => setStatus("done")}
          className="group/check relative flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 transition-colors hover:border-success disabled:pointer-events-none"
        >
          <span
            className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,2rem)] -translate-1/2"
            aria-hidden="true"
          />
          <Check
            className={cn(
              "size-3 stroke-success opacity-0 transition-opacity group-hover/check:opacity-100",
              justDone && "opacity-100",
            )}
          />
        </button>
      )}

      {task.priority !== "none" ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", priority.dotClass)}
          title={priority.label}
        />
      ) : null}

      <Link
        href={taskHref(propertyId, task.id)}
        className={cn(
          "min-w-0 flex-1 truncate text-sm hover:underline",
          justDone && "line-through",
        )}
      >
        {task.title}
      </Link>

      {assigneeName ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <ArrowRight className="size-3" />
          {assigneeName}
        </span>
      ) : null}

      {task.project_name ? (
        <span className="hidden max-w-32 shrink-0 truncate text-xs text-muted-foreground sm:inline">
          {task.project_name}
        </span>
      ) : null}

      {task.status === "in_progress" && !readOnly ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-info">
          <span className="size-1.5 rounded-full bg-info" />
          In progress
        </span>
      ) : null}

      {dueLabel ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs tabular-nums",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3" />
          {dueLabel}
        </span>
      ) : null}

      {!readOnly && task.status === "todo" ? (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 opacity-0 group-hover:opacity-100"
          disabled={busy}
          onClick={() => setStatus("in_progress")}
        >
          <Play data-slot="icon" />
          Start
        </Button>
      ) : (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
      )}
    </div>
  );
}
