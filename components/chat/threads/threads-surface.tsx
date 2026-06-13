"use client";

import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { ThreadsPageClient } from "./threads-view";

const THREADS_ROUTE = /^\/p\/[^/]+\/threads\/?$/;

/**
 * Persistent threads surface — mounted in the property layout so clicking
 * Threads in the chat sidebar is a `pushState`, not a route navigation.
 * The threads list itself owns its data fetching client-side.
 */
export function ThreadsSurface() {
  const pathname = useSurfacePathname();
  if (!THREADS_ROUTE.test(pathname)) return null;
  return <ThreadsPageClient />;
}
