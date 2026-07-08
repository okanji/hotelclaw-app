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
}: {
  propertyId: string;
  taskId: string;
}) {
  const { data: tasks, isPending } = useQuery(tasksQueryOptions(propertyId));

  if (isPending) return <TaskDetailSkeleton />;

  const row = tasks?.find((t) => t.id === taskId);
  if (!row) return <TaskNotFound propertyId={propertyId} />;

  const task = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueAt: row.due_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    source: row.source,
    sourceWorkflowId: row.source_workflow_id,
    sourceWorkflowRunId: row.source_workflow_run_id,
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
        <TaskDetail propertyId={propertyId} task={task} />
      </Suspense>
    </RoomProvider>
  );
}

function TaskNotFound({ propertyId }: { propertyId: string }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">This task is no longer available.</p>
      <Link
        href={`/p/${propertyId}/tasks`}
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        Back to tasks
      </Link>
    </div>
  );
}
