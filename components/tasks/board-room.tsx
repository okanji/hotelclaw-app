"use client";

import { ClientSideSuspense, RoomProvider } from "@liveblocks/react/suspense";
import { TasksBoard } from "./board";

export function TasksBoardRoom({ propertyId }: { propertyId: string }) {
  return (
    <RoomProvider
      id={`property:${propertyId}:tasks`}
      initialPresence={{ cursor: null, selectedTaskId: null }}
    >
      <ClientSideSuspense
        fallback={
          <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading tasks…
          </div>
        }
      >
        <TasksBoard propertyId={propertyId} />
      </ClientSideSuspense>
    </RoomProvider>
  );
}
