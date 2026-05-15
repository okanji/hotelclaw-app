"use client";

import { ClientSideSuspense, RoomProvider } from "@liveblocks/react/suspense";
import { TasksBoard } from "./board";

export function TasksBoardRoom({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  return (
    <RoomProvider
      id={`property:${propertyId}:tasks`}
      initialPresence={{
        cursor: null,
        selectedTaskId: null,
        draggingTaskId: null,
      }}
    >
      <ClientSideSuspense
        fallback={
          <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading tasks…
          </div>
        }
      >
        <TasksBoard propertyId={propertyId} currentUserId={currentUserId} />
      </ClientSideSuspense>
    </RoomProvider>
  );
}
