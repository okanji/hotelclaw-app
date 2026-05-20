"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  FileText,
  ListChecks,
  MessageCircle,
  MessagesSquare,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import { cn } from "@/lib/utils";
import { lastSectionPath } from "@/lib/shell/last-path";
import {
  tasksQueryOptions,
  documentsQueryOptions,
  documentsTreeQueryOptions,
  mentionsQueryOptions,
} from "@/lib/query/section-queries";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";

type RailItem = {
  section: ShellSection;
  label: string;
  icon: typeof Bell;
  /** Landing route pushed on click when the user isn't already in-section. */
  href?: string;
  /**
   * Unique pathname fragment for the "already inside this section" check —
   * set only for the pinned sections (activity/tasks/docs). Chat and DMs
   * share the /chat/* routes and are told apart via the section context.
   */
  routeKey?: string;
};

/**
 * Where a rail click for `item` should land. Every section jumps back to
 * wherever the user left off (recorded in localStorage by `LastPathRecorder`),
 * falling back to the section's landing route on first visit / cleared storage.
 *
 * DMs were previously hard-coded to the `/dms` index because conversations
 * shared `/chat/*` with team channels and a stale remembered path could open a
 * channel. With the `/dms/[channelId]` route split, `/dms/<id>` is
 * unambiguously a DM, so the same lookup is safe.
 */
function resolveTarget(
  propertyId: string,
  item: RailItem,
): string | undefined {
  return lastSectionPath(propertyId, item.section) ?? item.href;
}

/**
 * Any path inside the property layout — i.e. any URL the layout's persistent
 * section surfaces (chat / dms / tasks / docs / activity / threads / inbox)
 * own rendering for. Used as the pushState gate: a rail hop that stays
 * inside the layout can skip Next's cross-segment RSC fetch entirely.
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
 * Slack-style icon rail — the first sidebar, pinned to the screen edge. Five
 * square icon buttons switch the active section; the secondary sidebar
 * (`SectionSidebar`) renders content for whichever is selected. Rail and
 * secondary sidebar share `bg-sidebar` with no divider between them.
 */
export function AppRail({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { client } = useChatContext();
  const { section, setSection } = useShellSection();
  const { unseenCount } = useNotifications(userId);

  const items = useMemo<RailItem[]>(
    () => [
      {
        section: "activity",
        label: "Activity",
        icon: Bell,
        href: `/p/${propertyId}/activity`,
        routeKey: "/activity",
      },
      {
        section: "chat",
        label: "Chat",
        icon: MessagesSquare,
        href: `/p/${propertyId}/chat`,
      },
      {
        section: "dms",
        label: "DMs",
        icon: MessageCircle,
        // DMs get their own landing for the "nothing selected" state.
        // Conversations themselves render at `/chat/<id>` (shared with
        // channels) — handleClick uses the section context, not the path,
        // to tell Chat and DMs apart.
        href: `/p/${propertyId}/dms`,
      },
      {
        section: "tasks",
        label: "Tasks",
        icon: ListChecks,
        href: `/p/${propertyId}/tasks`,
        routeKey: "/tasks",
      },
      {
        section: "docs",
        label: "Docs",
        icon: FileText,
        href: `/p/${propertyId}/documents`,
        routeKey: "/documents",
      },
    ],
    [propertyId],
  );

  // The rail uses <button> + router.push (not <Link>), so Next never
  // auto-prefetches these routes. Warm them on mount: a cold first click
  // otherwise leaves the previous section's page on screen for the whole
  // server roundtrip (the section sidebar has already switched away) — e.g.
  // a chat channel briefly showing under the Activity rail. Each click
  // resolves to the section's remembered route, so warm that, not `href`.
  useEffect(() => {
    for (const item of items) {
      const target = resolveTarget(propertyId, item);
      if (target) router.prefetch(target);
    }
  }, [items, router, propertyId]);

  // Warm the section data caches once on entering the property, so the first
  // click into Tasks / Docs / Inbox is an instant React Query cache hit
  // instead of a skeleton. Activity is already warm — `useNotifications`
  // above subscribes to the same query; Chat is warm via Stream's
  // <ChannelList> watch. `prefetchQuery` respects staleTime, so it's a no-op
  // when the data is already fresh (e.g. the user is already in-section).
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

  // Pre-warm Stream's threads list so the first Threads click feels as
  // instant as a channel switch. Calling `activate()` (not `loadNextPage`)
  // is what fires the initial reload that populates `state.threads` —
  // it's the same code path `useThreadList()` runs when the threads page
  // mounts, just earlier. Idempotent; no harm if the page later activates
  // again on mount.
  useEffect(() => {
    if (!client?.user) return;
    client.threads.activate();
  }, [client]);

  function handleClick(item: RailItem) {
    setSection(item.section);
    if (!item.href) return;
    // Skip navigation when the user is already viewing this section's content
    // — just swap the sidebar, don't yank them off the page. Chat and DMs now
    // sit on distinct `/chat/*` vs `/dms/*` prefixes, but section context
    // remains the source of truth (a non-rail link can land on either route
    // without flipping the rail), so we stick with the pre-click section
    // comparison rather than the path.
    const isChatPair = item.section === "chat" || item.section === "dms";
    const alreadyInSection = isChatPair
      ? section === item.section
      : !!item.routeKey && pathname.includes(item.routeKey);
    if (alreadyInSection) return;
    const target = resolveTarget(propertyId, item);
    if (!target) return;

    // Every section's content is rendered by a persistent surface in the
    // property layout (chat, dms, tasks, docs, activity, threads, inbox) and
    // every `page.tsx` is `null` — so any rail hop that stays inside the
    // property layout can `pushState` instead of triggering a Next cross-
    // segment RSC fetch. The surface re-derives off the new URL and the
    // matching section renders in place; zero round-trip, no skeleton flash.
    //
    // `/chat` root is the lone exception: its `page.tsx` still does a server
    // `redirect()` to the first team channel (or renders "No channels yet"),
    // which pushState would skip. Fall through to `router.push` for that
    // target. It only fires on a user's very first Chat click (no
    // `lastSectionPath("chat")` recorded yet); from then on the rail
    // resolves to a real `/chat/<id>` path.
    if (
      IN_PROPERTY.test(pathname) &&
      IN_PROPERTY.test(target) &&
      !CHAT_ROOT.test(target)
    ) {
      window.history.pushState(null, "", target);
      return;
    }
    router.push(target);
  }

  return (
    <aside
      // Rail leads with its first icon; the secondary sidebar leads with the
      // property switcher. Each column owns its own top, separated by the
      // `border-r` between them — no synthetic baseline to maintain.
      className="flex w-(--rail-width) shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar pt-3 pb-3"
      aria-label="Sections"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = section === item.section;
        const showBadge = item.section === "activity" && unseenCount > 0;
        return (
          <button
            key={item.section}
            type="button"
            onClick={() => handleClick(item)}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
            className="group flex w-14 flex-col items-center gap-1 rounded-md py-1 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <span
              className={cn(
                "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 group-hover:bg-sidebar-accent/60 group-hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-[18px]" />
              {showBadge ? (
                <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-none font-semibold text-destructive-foreground tabular-nums">
                  {unseenCount > 99 ? "99+" : unseenCount}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "text-[11px] leading-none",
                isActive
                  ? "font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70",
              )}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </aside>
  );
}
