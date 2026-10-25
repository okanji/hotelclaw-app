"use client";

import { Suspense } from "react";
import Link from "next/link";
import { RoomProvider } from "@liveblocks/react";
import { useQuery } from "@tanstack/react-query";
import { tasksQueryOptions } from "@/lib/query/section-queries";
import { TaskDetail } from "./task-detail";
import { TaskDetailSkeleton } from "./task-detail-skeleton";

/**
 * Liveblocks room + data gate for a single task. Used both by the
 * `tasks/[taskId]` route and the Activity detail pane.
 *
 * The task is read out of the shared `["tasks", propertyId]` list cache —
 * warm from the rail prefetch / streamed in by the page — so there's no
 * per-task fetch and arriving from the board is instant. No
 * `ClientSideSuspense`: the plain <Suspense> is the boundary <TaskDetail>'s
 * Liveblocks suspense hooks need; it only shows the fallback if something
 * actually suspends. A missing task renders an inline message (not a 404),
 * since this also renders inside the Activity pane.
 */
export function TaskRoom({
  propertyId,
  taskId,
  variant,
}: {
  propertyId: string;
  taskId: string;
  /** Passed through to TaskDetail — "embedded" for hosts with their own chrome. */
  variant?: "page" | "embedded";
}) {
  const { data: tasks, isPending } = useQuery(tasksQueryOptions(propertyId));

  if (isPending) return <TaskDetailSkeleton />;

  const row = tasks?.find((t) => t.id === taskId);
  if (!row) return <TaskNotFound propertyId={propertyId} taskId={taskId} />;

  const task = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueAt: row.due_at,
    recurrence: row.recurrence ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    source: row.source,
    sourceWorkflowId: row.source_workflow_id,
    sourceWorkflowRunId: row.source_workflow_run_id,
    key: row.key ?? null,
  };

  return (
    <RoomProvider
      id={`property:${propertyId}:task:${task.id}`}
      initialPresence={{
        cursor: null,
        selectedTaskId: task.id,
        draggingTaskId: null,
        editingEventId: null,
        focusedDay: null,
        selectedCell: null,
        selectionRange: null,
        activeSheetId: null,
      }}
    >
      <Suspense fallback={<TaskDetailSkeleton />}>
        <TaskDetail propertyId={propertyId} task={task} variant={variant} />
      </Suspense>
    </RoomProvider>
  );
}

/**
 * The list cache excludes triage-queue tasks (0111), so a link to one —
 * a guest-ticket card, a notification — lands here. Ask the single-task
 * route before saying it's gone, and point pending ones at Triage.
 */
function TaskNotFound({
  propertyId,
  taskId,
}: {
  propertyId: string;
  taskId: string;
}) {
  const { data: triageState, isPending } = useQuery({
    queryKey: ["task-triage-state", propertyId, taskId],
    queryFn: async (): Promise<string | null> => {
      const res = await fetch(`/api/properties/${propertyId}/tasks/${taskId}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { triage_state?: string | null };
      return body.triage_state ?? null;
    },
  });

  if (isPending) return <TaskDetailSkeleton />;

  if (triageState === "pending") {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium">This task is waiting in Triage.</p>
        <Link
          href={`/p/${propertyId}/triage?task=${taskId}`}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          Open in Triage
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">
        {triageState === "declined"
          ? "This task was declined in Triage."
          : "This task is no longer available."}
      </p>
      <Link
        href={`/p/${propertyId}/tasks`}
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        Back to tasks
      </Link>
    </div>
  );
}
