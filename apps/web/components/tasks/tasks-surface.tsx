"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { TaskRoom } from "./task-room";
import { TasksBoardRoom } from "./board-room";

/** Any URL under the tasks section — used to gate the surface OFF other sections. */
const IN_TASKS = /^\/p\/[^/]+\/tasks(?:\/|$)/;
/** Captures the task id from `/p/<pid>/tasks/<id>`. */
const TASK_ROUTE = /^\/p\/[^/]+\/tasks\/([^/]+)\/?$/;

/**
 * Persistent tasks surface — mounted in the property layout, so the guard
 * below is critical: WITHOUT it the no-`taskId` branch would render the
 * board on every non-tasks URL.
 *
 * Reads the active task from the URL via `useSurfacePathname` (board ↔ detail
 * via `useOpenTask` and rail hops OFF the section both `pushState` + dispatch
 * `hotelclaw:pathname`; the hook stays in lockstep with the other surfaces so
 * the board never lingers on top of the next section). `key={taskId}` (or
 * `"board"`) forces a clean remount per item so Liveblocks's `RoomProvider`
 * captures the new room on first render.
 */
export function TasksSurface({
  propertyId,
  currentUserId,
}: {
  propertyId: string;
  currentUserId: string;
}) {
  // Only render under `/tasks/*` — the surface is now mounted property-wide,
  // so this is the section gate.
  const pathname = useSurfacePathname();
  if (!IN_TASKS.test(pathname)) return null;

  const taskId = pathname.match(TASK_ROUTE)?.[1];
  if (taskId) {
    return <TaskRoom key={taskId} propertyId={propertyId} taskId={taskId} />;
  }
  return (
    <TasksBoardRoom
      key="board"
      propertyId={propertyId}
      currentUserId={currentUserId}
    />
  );
}
