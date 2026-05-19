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
 * Where a rail click for `item` should land.
 *
 * Most sections jump back to wherever the user left off (recorded in
 * localStorage by `LastPathRecorder`), falling back to the landing route.
 * DMs are the exception: their conversations live on the `/chat/*` routes
 * shared with team channels, so a remembered path can't be confirmed to be a
 * DM — a stale entry from a section/route desync would open a channel. DMs
 * therefore always land on the `/dms` index, whose sidebar lists them.
 */
function resolveTarget(
  propertyId: string,
  item: RailItem,
): string | undefined {
  if (item.section === "dms") return item.href;
  return lastSectionPath(propertyId, item.section) ?? item.href;
}

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

  function handleClick(item: RailItem) {
    setSection(item.section);
    if (!item.href) return;
    // Skip navigation when the user is already viewing this section's content
    // — just swap the sidebar, don't yank them off the page. Chat and DMs
    // share the /chat/* routes, so only the section context distinguishes
    // them (`section` here is still the pre-click value); the pinned sections
    // are matched by their unique route prefix, since their section can lag
    // the route when a non-rail link lands on a /chat/* page.
    const isChatPair = item.section === "chat" || item.section === "dms";
    const alreadyInSection = isChatPair
      ? section === item.section
      : !!item.routeKey && pathname.includes(item.routeKey);
    if (alreadyInSection) return;
    const target = resolveTarget(propertyId, item);
    if (target) router.push(target);
  }

  return (
    <aside
      // pt-[45px] lines the first rail icon glyph up with the Search icon in
      // the secondary sidebar. The Search icon sits 58px down (8px header
      // padding + 36px property switcher + 8px header gap + 6px icon centering
      // in the h-7 row); a rail icon sits 13px below the aside's top padding
      // (4px button padding + 9px centering of the 18px glyph in the size-9
      // hit area), so 58 − 13 = 45.
      className="flex w-(--rail-width) shrink-0 flex-col items-center gap-1 bg-sidebar pt-[45px] pb-3"
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
