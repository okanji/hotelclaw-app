"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { MyTasks } from "./my-tasks";

/** The personal-agenda route exactly. `/my-tasks` lives under the Home rail but
 *  has no detail route — present or absent. */
const IN_MY_TASKS = /^\/p\/[^/]+\/my-tasks\/?$/;

/**
 * Persistent My Tasks surface — mounted in the property layout beside the other
 * section surfaces so a rail/pushState hop in or out of `/my-tasks` swaps it in
 * place instead of leaving the real page mounted under the next surface (the
 * "split pane" bug). The gate reads `useSurfacePathname`, which stays in
 * lockstep with the other surfaces across `pushState`.
 */
export function MyTasksSurface({
  propertyId,
  userId,
  userName,
}: {
  propertyId: string;
  userId: string;
  userName: string | null;
}) {
  const pathname = useSurfacePathname();

  if (!IN_MY_TASKS.test(pathname)) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MyTasks propertyId={propertyId} userId={userId} firstName={userName} />
    </div>
  );
}
