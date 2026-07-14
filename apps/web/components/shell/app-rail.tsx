"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Bot,
  CalendarDays,
  FileText,
  Home,
  LineChart,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Ticket,
  Video,
  Workflow,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChatContext } from "stream-chat-react";
import { lastSectionPath } from "@/lib/shell/last-path";
import {
  tasksQueryOptions,
  documentsQueryOptions,
  documentsTreeQueryOptions,
  mentionsQueryOptions,
} from "@/lib/query/section-queries";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import { pendingBookingsCountQueryOptions } from "@/lib/query/booking-queries";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";
import { UserMenu } from "./user-menu";
import { RailOrgSwitcher } from "./rail-org-switcher";
import type { Membership } from "@/lib/auth/session";

/**
 * Slack-style nav button: a stacked icon-tile + label. The whole button is the
 * `group`; only the inner tile carries the active/hover surface (a soft
 * translucent-white square, never a high-contrast fill), so the label stays
 * legible and the lift reads on the aubergine gradient. The tile holds the
 * corner badges. Label weight never changes between states — only its color.
 */
const railItemClass =
  "group/item flex w-full flex-col items-center gap-1.5 rounded-xl py-2 outline-hidden";
// Light-first: neutral icons/wash on the white rail, with `dark:` restoring the
// always-dark look (white icons, translucent-white wash).
const railTileClass =
  "relative flex size-9 items-center justify-center rounded-xl transition-colors " +
  "text-zinc-700 group-hover/item:bg-black/5 group-hover/item:text-zinc-900 " +
  "data-current:bg-black/[0.07] data-current:text-zinc-900 " +
  "group-focus-visible/item:ring-2 group-focus-visible/item:ring-black/15 " +
  "dark:text-white/85 dark:group-hover/item:bg-white/10 dark:group-hover/item:text-white " +
  "dark:data-current:bg-white/15 dark:data-current:text-white " +
  "dark:group-focus-visible/item:ring-white/40";
const railLabelClass =
  "block w-full truncate text-center text-xs font-semibold leading-none tracking-tight transition-colors";
// Active vs inactive label color, both themes — applied via cn() in the markup.
const railLabelActiveClass = "text-zinc-900 dark:text-white";
const railLabelIdleClass =
  "text-zinc-600 group-hover/item:text-zinc-900 dark:text-white/85 dark:group-hover/item:text-white";

/** Translucent circular utility button used by the rail footer (collapse). */
const railFooterButtonClass =
  "flex size-7 items-center justify-center rounded-full outline-hidden transition-colors " +
  "bg-black/5 text-zinc-600 hover:bg-black/10 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-black/15 " +
  "dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20 dark:hover:text-white dark:focus-visible:ring-white/40";

/**
 * Back-office surfaces that live under the rail's "More" overflow rather than as
 * top-level icons — keeps the primary rail short (Slack-style). The `items`
 * array order is preserved when splitting, so these stay grouped at the bottom
 * of the More panel. Each gets a one-line description for the menu row.
 */
const MORE_SECTIONS = new Set<ShellSection>([
  "dms",
  "workflows",
  "chatbots",
  "bookings",
  "meetings",
]);
const MORE_DESCRIPTIONS: Partial<Record<ShellSection, string>> = {
  dms: "Direct messages",
  workflows: "Automate tasks and triggers",
  chatbots: "Build guest-facing assistants",
  bookings: "Reservations and availability",
  meetings: "Video calls and recordings",
};

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
 * Chatbots is server-rendered the same way meetings is — its pages return
 * real JSX, so rail hops in or out need a real navigation, not pushState.
 */
const CHATBOTS_ROUTE = /^\/p\/[^/]+\/chatbots(\/.*)?$/;
/** Bookings is server-rendered too — same real-navigation requirement. */
const BOOKINGS_ROUTE = /^\/p\/[^/]+\/bookings(\/.*)?$/;
/** Forms pages (list, builder, fill) are server-rendered routes reached
 *  from the Documents sidebar — same real-navigation requirement. */
const FORMS_ROUTE = /^\/p\/[^/]+\/forms(\/.*)?$/;

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
  memberships,
  isManagement,
}: {
  propertyId: string;
  userId: string;
  user: RailUser;
  memberships: Membership[];
  isManagement: boolean;
}) {
  const router = useRouter();
  // `usePathname` only updates on real Next navigations — but most rail hops
  // and every in-section detail open use `pushState`, which it doesn't track
  // (see `documents-surface.tsx`). The rail makes routing decisions off the
  // *current* location (`alreadyInSection`, the chatbots/meetings server-
  // rendered exceptions), so it must mirror `window.location` the same way the
  // surfaces do — otherwise a stale path makes `handleClick` skip navigation
  // entirely or pick `pushState` when a real `router.push` was needed.
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
  const queryClient = useQueryClient();
  const { client } = useChatContext();
  const { section, setSection, sidebarCollapsed, setSidebarCollapsed } =
    useShellSection();
  const { unseenCount } = useNotifications(userId);

  // Amber dot on the Workflows icon while any enabled workflow's most recent
  // run failed — ambient "an automation needs attention" without a count.
  const { data: workflows } = useQuery(workflowsListQueryOptions(propertyId));
  const failingWorkflows = useMemo(
    () =>
      (workflows ?? []).filter((w) => w.enabled && w.last_run_status === "failed")
        .length,
    [workflows],
  );

  // Amber count on the Bookings icon while chatbot bookings sit pending —
  // the front desk's "needs a yes" number. Realtime invalidation lives in
  // BookingsSection (same query key).
  const { data: pendingBookings = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );

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
        section: "insights",
        // Management reads the property; staff get their personal "My week".
        label: isManagement ? "Insights" : "My week",
        icon: LineChart,
        // Still served from `/home/insights`; its own persistent surface in
        // the property layout renders it, so a rail hop pushState-swaps in.
        href: `/p/${propertyId}/home/insights`,
        routeKey: "/home/insights",
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
        section: "chatbots",
        label: "Chatbots",
        icon: Bot,
        href: `/p/${propertyId}/chatbots`,
        routeKey: "/chatbots",
      },
      {
        section: "bookings",
        label: "Bookings",
        icon: Ticket,
        href: `/p/${propertyId}/bookings`,
        routeKey: "/bookings",
      },
      {
        section: "meetings",
        label: "Meetings",
        icon: Video,
        href: `/p/${propertyId}/meetings`,
        routeKey: "/meetings",
      },
    ],
    [propertyId, isManagement],
  );

  const primaryItems = useMemo(
    () => items.filter((i) => !MORE_SECTIONS.has(i.section)),
    [items],
  );
  const moreItems = useMemo(
    () => items.filter((i) => MORE_SECTIONS.has(i.section)),
    [items],
  );
  // The overflow's own active/alert state, surfaced on the More button itself.
  const moreActive = MORE_SECTIONS.has(section);
  const moreAlert = failingWorkflows > 0 || pendingBookings > 0;

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
      : !!item.routeKey &&
        pathname.includes(item.routeKey) &&
        // `/home` is a substring of `/home/insights`; Insights is its own rail
        // section now, so Home must not read as "already active" from within
        // Insights (its own routeKey is the more specific `/home/insights`).
        !(item.section === "home" && pathname.includes("/home/insights"));
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
      !MEETINGS_ROUTE.test(pathname) &&
      !CHATBOTS_ROUTE.test(target) &&
      !CHATBOTS_ROUTE.test(pathname) &&
      !BOOKINGS_ROUTE.test(target) &&
      !BOOKINGS_ROUTE.test(pathname) &&
      !FORMS_ROUTE.test(target) &&
      !FORMS_ROUTE.test(pathname)
    ) {
      window.history.pushState(null, "", target);
      // Notify surfaces (and this rail's own mirror) synchronously — `pushState`
      // alone doesn't update `usePathname`, so without this the surface gating
      // on the new URL wouldn't re-render until Next's deferred path update.
      window.dispatchEvent(new Event("hotelclaw:pathname"));
      return;
    }
    router.push(target);
  }

  return (
    <TooltipProvider delay={0}>
      <aside
        // Flat rail on the shared `bg-sidebar` surface — same color as the
        // secondary sidebar, separated from it only by the inset hairline on
        // the sidebar's left edge (see SectionSidebar). Slack-style icon +
        // label stack — labels are always visible (no tooltip).
        // pt-4 keeps the org tile on the same line it sat on when the rail was
        // an m-2-inset card (8px margin + 8px padding), so it still aligns
        // with the property switcher across the seam.
        className="flex w-[72px] shrink-0 flex-col items-center bg-sidebar px-2 pt-4 pb-3"
        aria-label="Sections"
      >
        <div className="mt-0.5 mb-4 flex justify-center">
          {/* Org mark — the current property's colored-initial tile, doubling
              as a workspace switcher (switch org / add org). */}
          <RailOrgSwitcher
            currentPropertyId={propertyId}
            memberships={memberships}
          />
        </div>

        {/* Icons flow top-to-bottom, not vertically centered. */}
        <nav className="no-scrollbar flex min-h-0 w-full flex-1 flex-col justify-start overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {primaryItems.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.section;
              const showBadge =
                item.section === "activity" && unseenCount > 0;
              const showFailingDot =
                item.section === "workflows" && failingWorkflows > 0;
              const showPendingBookings =
                item.section === "bookings" && pendingBookings > 0;
              return (
                <li key={item.section}>
                  <button
                    type="button"
                    onClick={() => handleClick(item)}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={railItemClass}
                  >
                    <span
                      {...(isActive ? { "data-current": "" } : {})}
                      className={railTileClass}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.75} />
                      {showBadge ? (
                        // Lavender count badge punched onto the icon's
                        // top-right corner (unseen notifications). The ring in
                        // the rail bg gives the cutout look.
                        <span className="absolute -top-1 -right-1 z-10 flex h-4 min-w-4 animate-in zoom-in-50 items-center justify-center rounded-full bg-[#cba4e6] px-1 text-[9px] leading-none font-semibold text-[#1c0f1c] tabular-nums ring-2 ring-sidebar duration-200">
                          {unseenCount > 9 ? "9+" : unseenCount}
                        </span>
                      ) : null}
                      {showFailingDot ? (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-0.5 z-10 size-2 rounded-full bg-amber-400 ring-2 ring-sidebar"
                        />
                      ) : null}
                      {showPendingBookings ? (
                        // Same cutout treatment as the activity count,
                        // amber: bookings waiting on a staff yes.
                        <span className="absolute -top-1 -right-1 z-10 flex h-4 min-w-4 animate-in zoom-in-50 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] leading-none font-semibold text-[#1c0f1c] tabular-nums ring-2 ring-sidebar duration-200">
                          {pendingBookings > 9 ? "9+" : pendingBookings}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        railLabelClass,
                        isActive ? railLabelActiveClass : railLabelIdleClass,
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                </li>
              );
            })}

            {moreItems.length > 0 ? (
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="More"
                    aria-current={moreActive ? "page" : undefined}
                    className={railItemClass}
                  >
                    <span
                      {...(moreActive ? { "data-current": "" } : {})}
                      className={cn(
                        railTileClass,
                        "group-data-[popup-open]/item:bg-black/[0.07] group-data-[popup-open]/item:text-zinc-900 dark:group-data-[popup-open]/item:bg-white/15 dark:group-data-[popup-open]/item:text-white",
                      )}
                    >
                      <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
                      {moreAlert && !moreActive ? (
                        <span
                          aria-hidden="true"
                          className="absolute -top-0.5 -right-0.5 z-10 size-2 rounded-full bg-amber-400 ring-2 ring-sidebar"
                        />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        railLabelClass,
                        moreActive
                          ? railLabelActiveClass
                          : cn(
                              railLabelIdleClass,
                              "group-data-[popup-open]/item:text-zinc-900 dark:group-data-[popup-open]/item:text-white",
                            ),
                      )}
                    >
                      More
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="right"
                    align="end"
                    sideOffset={8}
                    className="w-72"
                  >
                    <p className="px-2 pt-1.5 pb-1 text-sm font-semibold text-foreground">
                      More
                    </p>
                    {moreItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = section === item.section;
                      const failing =
                        item.section === "workflows" && failingWorkflows > 0;
                      const pending =
                        item.section === "bookings" && pendingBookings > 0;
                      return (
                        <DropdownMenuItem
                          key={item.section}
                          onClick={() => handleClick(item)}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "gap-3 px-2 py-2",
                            isActive && "bg-accent/60",
                          )}
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                            <Icon className="size-5" strokeWidth={1.75} />
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                              {item.label}
                              {failing ? (
                                <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                                  {failingWorkflows} failing
                                </span>
                              ) : null}
                              {pending ? (
                                <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                                  {pendingBookings} pending
                                </span>
                              ) : null}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {MORE_DESCRIPTIONS[item.section]}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ) : null}
          </ul>
        </nav>

        <div className="mt-3 flex shrink-0 flex-col items-center gap-2 pb-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
                  aria-pressed={sidebarCollapsed}
                  className={railFooterButtonClass}
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" strokeWidth={1.75} />
                  ) : (
                    <PanelLeftClose className="size-4" strokeWidth={1.75} />
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
