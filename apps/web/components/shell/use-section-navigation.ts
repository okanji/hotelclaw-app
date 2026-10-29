"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectedStreamClient } from "@/lib/stream/client-provider";
import { lastSectionPath } from "@/lib/shell/last-path";
import {
  tasksQueryOptions,
  documentsQueryOptions,
  documentsTreeQueryOptions,
  mentionsQueryOptions,
} from "@/lib/query/section-queries";
import { useShellSection, type ShellSection } from "./shell-section-context";

/** One top-level sidebar destination. */
export type SectionTarget = {
  section: ShellSection;
  /** Landing route pushed on click when the user isn't already in-section. */
  href: string;
  /**
   * Unique pathname fragment for the "already inside this section" check —
   * set only for sections whose routes share nothing with another section's.
   * Chat and DMs are told apart via the section context instead.
   */
  routeKey?: string;
};

/**
 * Where a click on `item` should land. Every section jumps back to wherever
 * the user left off (recorded in localStorage by `LastPathRecorder`), falling
 * back to the section's landing route on first visit / cleared storage.
 */
function resolveTarget(propertyId: string, item: SectionTarget): string {
  return lastSectionPath(propertyId, item.section) ?? item.href;
}

/**
 * Any path inside the property layout — i.e. any URL the layout's persistent
 * section surfaces (chat / dms / tasks / docs / activity / threads / inbox)
 * own rendering for. Used as the pushState gate: a hop that stays inside the
 * layout can skip Next's cross-segment RSC fetch entirely.
 */
const IN_PROPERTY = /^\/p\/[^/]+\/[^/]+/;
/**
 * The bare `/chat` root — the one in-property exception. Its `page.tsx`
 * still runs a server `redirect()` to pick the first team channel (or
 * renders "No channels yet"); pushState would skip that and leave the
 * surface empty.
 */
const CHAT_ROOT = /^\/p\/[^/]+\/chat\/?$/;
/**
 * Server-rendered sections: unlike chat/tasks/docs, which mount persistent
 * surfaces in the property layout, these pages return real JSX from
 * `page.tsx`. A pushState would leave the previous surface visible while
 * only the URL changes, so hops in or out need a real navigation.
 */
const SERVER_RENDERED = [
  /^\/p\/[^/]+\/meetings(\/.*)?$/,
  /^\/p\/[^/]+\/chatbots(\/.*)?$/,
  /^\/p\/[^/]+\/agents(\/.*)?$/,
  /^\/p\/[^/]+\/assistant(\/.*)?$/,
  /^\/p\/[^/]+\/forms(\/.*)?$/,
  /^\/p\/[^/]+\/triage(\/.*)?$/,
  /^\/p\/[^/]+\/cycles(\/.*)?$/,
  /^\/p\/[^/]+\/initiatives(\/.*)?$/,
];
function isServerRendered(path: string): boolean {
  return SERVER_RENDERED.some((rx) => rx.test(path));
}

/**
 * The pathname as the surfaces see it. `usePathname` only updates on real
 * Next navigations — but most section hops and every in-section detail open
 * use `pushState`, which it doesn't track (see `documents-surface.tsx`).
 * Routing decisions (`alreadyInSection`, the server-rendered exceptions)
 * must read the *current* location or a stale path makes a click skip
 * navigation entirely, or pick `pushState` when a real push was needed.
 */
export function useLivePathname(): string {
  const nextPathname = usePathname();
  const [pathname, setPathname] = useState(nextPathname);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPathname(nextPathname);
  }, [nextPathname]);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener("hotelclaw:pathname", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hotelclaw:pathname", sync);
    };
  }, []);
  return pathname;
}

/**
 * Section-level navigation for the sidebar's top-level rows. Returns
 * `navigate(item)`: first click into a section resumes where you left off;
 * clicking the section you're already in goes to its root (Slack / Linear
 * convention — otherwise a deep page had no one-click way out). Hops that
 * stay inside the property layout `pushState` (zero round-trip, no skeleton
 * flash); the server-rendered sections get a real `router.push`.
 */
export function useSectionNavigation(propertyId: string) {
  const router = useRouter();
  const pathname = useLivePathname();
  const { section, setSection, expand } = useShellSection();

  const navigate = useCallback(
    (item: SectionTarget) => {
      setSection(item.section);
      expand(item.section);
      // Chat and DMs share the /chat-vs-/dms split but ONE sidebar node;
      // section context remains the source of truth for "already here".
      const isChatPair = item.section === "chat" || item.section === "dms";
      const alreadyInSection = isChatPair
        ? section === item.section
        : !!item.routeKey &&
          pathname.includes(item.routeKey) &&
          // `/home` is a substring of `/home/insights`; Insights is its own
          // section, so Home must not read as "already active" from within
          // Insights (its own routeKey is the more specific `/home/insights`).
          !(item.section === "home" && pathname.includes("/home/insights"));
      // `section === item.section` also counts routes the section owns
      // without its routeKey (Home's /projects, /spaces, /my-tasks).
      const inSection = alreadyInSection || section === item.section;
      let target: string;
      if (inSection) {
        if (isChatPair) return;
        const here = window.location.pathname + window.location.search;
        if (here === item.href) return;
        target = item.href;
      } else {
        target = resolveTarget(propertyId, item);
      }

      if (
        IN_PROPERTY.test(pathname) &&
        IN_PROPERTY.test(target) &&
        !CHAT_ROOT.test(target) &&
        !isServerRendered(target) &&
        !isServerRendered(pathname)
      ) {
        window.history.pushState(null, "", target);
        // `pushState` alone doesn't update `usePathname` — notify the
        // surfaces (and `useLivePathname`) synchronously so the surface
        // gating on the new URL re-renders now, not on Next's deferred update.
        window.dispatchEvent(new Event("hotelclaw:pathname"));
        return;
      }
      router.push(target);
    },
    [propertyId, pathname, router, section, setSection, expand],
  );

  return { navigate, pathname };
}

/**
 * Warm every section's route + data once on entering the property, so the
 * first click into Tasks / Docs / Mentions is an instant cache hit instead
 * of a skeleton. The rows are buttons (not `<Link>`s), so Next never
 * auto-prefetches their routes; each click resolves to the section's
 * remembered route, so warm that, not `href`. `prefetchQuery` respects
 * staleTime, so it's a no-op when the data is already fresh.
 */
export function usePrewarmSections(
  propertyId: string,
  userId: string,
  items: SectionTarget[],
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useConnectedStreamClient();

  useEffect(() => {
    for (const item of items) router.prefetch(resolveTarget(propertyId, item));
  }, [items, router, propertyId]);

  useEffect(() => {
    queryClient.prefetchQuery(tasksQueryOptions(propertyId));
    queryClient.prefetchQuery(documentsQueryOptions(propertyId));
    queryClient.prefetchQuery(documentsTreeQueryOptions(propertyId));
    if (client?.user) {
      queryClient.prefetchQuery(
        mentionsQueryOptions(propertyId, userId, client),
      );
    }
  }, [queryClient, propertyId, userId, client]);

  // Pre-warm Stream's threads list so the first Replies click feels as
  // instant as a channel switch. `activate()` (not `loadNextPage`) is what
  // fires the initial reload that populates `state.threads` — the same path
  // `useThreadList()` runs when the threads page mounts, just earlier.
  // Idempotent; no harm if the page later activates again on mount.
  useEffect(() => {
    if (!client?.user) return;
    client.threads.activate();
  }, [client]);
}
