"use client";

import { Suspense } from "react";
import { RoomProvider } from "@liveblocks/react";
import { TasksBoard } from "./board";
import { TasksBoardSkeleton } from "./board-skeleton";

/**
 * Liveblocks room for the tasks board.
 *
 * No `ClientSideSuspense` wrapper: the board renders immediately from its
 * hydrated React Query cache, and the non-suspense Liveblocks hooks in
 * <TasksBoard> fill in presence once the room connects — so opening Tasks
 * never blocks on the websocket.
 *
 * The plain <Suspense> is the boundary <TasksBoard>'s `useSearchParams()`
 * needs; it only shows the fallback if something actually suspends.
 */
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
        editingEventId: null,
        focusedDay: null,
      }}
    >
      <Suspense fallback={<TasksBoardSkeleton />}>
        <TasksBoard propertyId={propertyId} currentUserId={currentUserId} />
      </Suspense>
    </RoomProvider>
  );
}
