"use client";

import { RoomProvider, ClientSideSuspense } from "@liveblocks/react/suspense";
import { TaskDetail } from "./task-detail";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueAt: string | null;
};

export function TaskRoom({
  propertyId,
  task,
}: {
  propertyId: string;
  task: Task;
}) {
  return (
    <RoomProvider
      id={`property:${propertyId}:task:${task.id}`}
      initialPresence={{
        cursor: null,
        selectedTaskId: task.id,
        draggingTaskId: null,
      }}
    >
      <ClientSideSuspense
        fallback={
          <div className="p-8 text-sm text-muted-foreground">Loading task…</div>
        }
      >
        <TaskDetail propertyId={propertyId} task={task} />
      </ClientSideSuspense>
    </RoomProvider>
  );
}
