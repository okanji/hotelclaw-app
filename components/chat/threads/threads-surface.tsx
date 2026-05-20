"use client";

import { usePathname } from "next/navigation";
import { ThreadsPageClient } from "./threads-view";

const THREADS_ROUTE = /^\/p\/[^/]+\/threads\/?$/;

/**
 * Persistent threads surface — mounted in the property layout so clicking
 * Threads in the chat sidebar is a `pushState`, not a route navigation.
 * The threads list itself owns its data fetching client-side.
 */
export function ThreadsSurface() {
  const pathname = usePathname();
  if (!THREADS_ROUTE.test(pathname)) return null;
  return <ThreadsPageClient />;
}
