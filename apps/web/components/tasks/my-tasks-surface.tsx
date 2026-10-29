"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { MyTasksView } from "@/components/gr8r/my-tasks-view";

/** The personal-agenda route exactly. `/my-tasks` lives under the Home rail but
 *  has no detail route — present or absent. */
const IN_MY_TASKS = /^\/p\/[^/]+\/my-tasks\/?$/;

/**
 * Persistent My Tasks surface — mounted in the property layout beside the other
 * section surfaces so a rail/pushState hop in or out of `/my-tasks` swaps it in
 * place instead of leaving the real page mounted under the next surface (the
 * "split pane" bug). The gate reads `useSurfacePathname`, which stays in
 * lockstep with the other surfaces across `pushState`. The page itself is
 * gr8r-studio's `pageMyTasks` (`components/gr8r/my-tasks-view.tsx`).
 */
export function MyTasksSurface({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
}) {
  const pathname = useSurfacePathname();

  if (!IN_MY_TASKS.test(pathname)) return null;

  return <MyTasksView propertyId={propertyId} userId={userId} />;
}
