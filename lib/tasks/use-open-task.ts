"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { taskHref } from "./task-href";

/**
 * Pathnames that mount the persistent `<TasksSurface>`. Inside them, task
 * navigation is a client-side `pushState`; arriving from another section is a
 * real `router.push`. Both `tasks/page.tsx` and `tasks/[taskId]/page.tsx`
 * render `null`, so the surface fully owns rendering and pushState works for
 * board ↔ detail and detail ↔ detail transitions.
 */
const IN_TASKS_SURFACE = /^\/p\/[^/]+\/tasks(?:\/|$)/;

/**
 * Opens a task.
 *
 * When the user is already on a `/tasks/[id]` route, this is a pure
 * `window.history.pushState` — no Next route navigation, no `TaskDetailSkeleton`
 * flash. The persistent surface re-renders, `<TaskRoom>` remounts with the new
 * id (clean form + comments per task), and Liveblocks switches rooms. From the
 * board or another section it falls back to a normal `router.push`.
 *
 * Single chokepoint for task navigation, mirroring `taskHref`.
 */
export function useOpenTask(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (taskId: string) => {
      const href = taskHref(propertyId, taskId);
      if (IN_TASKS_SURFACE.test(window.location.pathname)) {
        window.history.pushState(null, "", href);
        // `usePathname` does not update on `pushState` — the surface listens
        // for this event to re-derive the active task id from the new URL.
        window.dispatchEvent(new Event("hotelclaw:pathname"));
      } else {
        router.push(href);
      }
    },
    [propertyId, router],
  );
}
