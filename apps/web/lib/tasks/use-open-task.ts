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
/** A task's own page — the one place task navigation stays a page hop. */
const ON_TASK_PAGE = /^\/p\/[^/]+\/tasks\/(?!new(?:\/|$))[^/]+/;
/** Where `?task=` already means something else (triage's selection). */
const NO_DRAWER = /^\/p\/[^/]+\/triage(?:\/|$)/;

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
 *
 * gr8r-studio (2026-10-29): everywhere else a task opens in the right-hand
 * drawer over the current view — `?task=<id>` on the current URL, read by
 * `components/gr8r/task-drawer.tsx`. Modified clicks / "Open as page" still
 * reach `/tasks/<id>` through `taskHref`.
 */
export function useOpenTask(propertyId: string) {
  const router = useRouter();
  return useCallback(
    (taskId: string) => {
      const href = taskHref(propertyId, taskId);
      const path = window.location.pathname;
      if (!ON_TASK_PAGE.test(path) && !NO_DRAWER.test(path)) {
        const url = new URL(window.location.href);
        url.searchParams.set("task", taskId);
        router.push(`${url.pathname}${url.search}`, { scroll: false });
        return;
      }
      if (IN_TASKS_SURFACE.test(path)) {
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
