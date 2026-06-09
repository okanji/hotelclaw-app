"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  FileText,
  Home,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Video,
  Workflow,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import { lastSectionPath } from "@/lib/shell/last-path";
import {
  tasksQueryOptions,
  documentsQueryOptions,
  documentsTreeQueryOptions,
  mentionsQueryOptions,
} from "@/lib/query/section-queries";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";
import { UserMenu } from "./user-menu";
import { RailLogo } from "./rail-logo";

/**
 * Icon-button styling ported 1:1 from the rail prototype. The rail is always
 * dark, so icons are white; the active item gets a slightly raised `#333` fill
 * with a top-left radial highlight + inset hairline ring, and a br gradient
 * sheen overlay (the child span). Inactive items lift on hover.
 */
const railLinkClass =
  "group relative flex size-10 items-center justify-center rounded-lg text-white transition-colors " +
  "outline-hidden focus-visible:ring-2 focus-visible:ring-white/30 " +
  "data-current:bg-[#333333] data-current:inset-ring-1 data-current:inset-ring-white/3 " +
  "data-current:bg-radial-[at_0%_0%] data-current:from-white/10 data-current:to-transparent " +
  "hover:not-data-current:bg-white/10";

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
 * Meetings is the second exception: unlike chat/tasks/docs which mount
 * persistent surfaces in the property layout, the meetings page is a
 * normal server-rendered route (`/meetings/page.tsx` returns JSX, not
 * null). A pushState would leave the previous surface visible while only
 * the URL changes. Force a real navigation so `children` re-renders.
 */
const MEETINGS_ROUTE = /^\/p\/[^/]+\/meetings(\/.*)?$/;

/**
 * Slack-style icon rail — the first sidebar, pinned to the screen edge. Five
 * square icon buttons switch the active section; the secondary sidebar
 * (`SectionSidebar`) renders content for whichever is selected. Rail and
 * secondary sidebar share `bg-sidebar` with no divider between them.
 */
type RailUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export function AppRail({
  propertyId,
  userId,
  user,
}: {
  propertyId: string;
  userId: string;
  user: RailUser;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { client } = useChatContext();
  const { section, setSection, sidebarCollapsed, setSidebarCollapsed } =
    useShellSection();
  const { unseenCount } = useNotifications(userId);

  const items = useMemo<RailItem[]>(
    () => [
      {
        section: "home",
        label: "Home",
        icon: Home,
        href: `/p/${propertyId}/home`,
        routeKey: "/home",
      },
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
        section: "calendar",
        label: "Calendar",
        icon: CalendarDays,
        href: `/p/${propertyId}/calendar`,
        routeKey: "/calendar",
      },
      {
        section: "docs",
        label: "Docs",
        icon: FileText,
        href: `/p/${propertyId}/documents`,
        routeKey: "/documents",
      },
      {
        section: "workflows",
        label: "Workflows",
        icon: Workflow,
        href: `/p/${propertyId}/workflows`,
        routeKey: "/workflows",
      },
      {
        section: "meetings",
        label: "Meetings",
        icon: Video,
        href: `/p/${propertyId}/meetings`,
        routeKey: "/meetings",
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

  // Linear-style sidebar toggle — ⌘\ (Mac) / Ctrl\ (Win/Linux). Ignored while
  // typing so it doesn't swallow a literal backslash in an input/editor.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "\\" || !(e.metaKey || e.ctrlKey)) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA")
      ) {
        return;
      }
      e.preventDefault();
      setSidebarCollapsed(!sidebarCollapsed);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarCollapsed, setSidebarCollapsed]);

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
      !CHAT_ROOT.test(target) &&
      !MEETINGS_ROUTE.test(target) &&
      !MEETINGS_ROUTE.test(pathname)
    ) {
      window.history.pushState(null, "", target);
      return;
    }
    router.push(target);
  }

  return (
    <TooltipProvider delay={0}>
      <aside
        // Always-dark floating rail (ported from the prototype): a rounded
        // `#090909` card with a soft drop shadow, separated from the secondary
        // sidebar by the surrounding `bg-sidebar`. Icon-only — labels live in
        // hover tooltips. `m-2` matches the inset card's gutter so the whole
        // shell reads as evenly-spaced floating panels.
        className="m-2 flex w-16 shrink-0 flex-col items-center rounded-xl bg-[#090909] p-3"
        aria-label="Sections"
      >
        <figure className="mb-6 mt-1">
          <RailLogo />
        </figure>

        <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.section;
              const showBadge =
                item.section === "activity" && unseenCount > 0;
              return (
                <li key={item.section}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={() => handleClick(item)}
                          aria-label={item.label}
                          aria-current={isActive ? "page" : undefined}
                          {...(isActive ? { "data-current": "" } : {})}
                          className={railLinkClass}
                        >
                          <Icon className="size-[18px]" />
                          {showBadge ? (
                            <span className="absolute -top-0.5 -right-0.5 z-10 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] leading-none font-semibold text-destructive-foreground tabular-nums">
                              {unseenCount > 99 ? "99+" : unseenCount}
                            </span>
                          ) : null}
                          {/* br gradient sheen — visible only on the active item */}
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 hidden rounded-[inherit] bg-linear-to-br from-white/15 to-transparent to-35% group-data-current:block"
                          />
                        </button>
                      }
                    />
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-3 flex shrink-0 flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
                  aria-pressed={sidebarCollapsed}
                  className="flex size-10 items-center justify-center rounded-lg text-white/70 outline-hidden transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-[18px]" />
                  ) : (
                    <PanelLeftClose className="size-[18px]" />
                  )}
                </button>
              }
            />
            <TooltipContent side="right">
              {sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              <kbd
                data-slot="kbd"
                className="ml-1 rounded bg-background/15 px-1 font-sans text-[0.625rem] text-background/80"
              >
                ⌘\
              </kbd>
            </TooltipContent>
          </Tooltip>
          <UserMenu user={user} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
