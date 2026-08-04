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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/count-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";
import { UserMenu } from "./user-menu";
import { BrandMark } from "./rail-logo";

/**
 * The app top bar — brand mark + horizontal section tabs + account controls.
 * Replaces the vertical icon rail (2026-07-12 redesign). Notion-normalized
 * 2026-08-04: 14px/500 secondary-ink labels, 6px radius, the active tab is
 * the hover fill at rest with full ink (no pill, no ring, no bold).
 *
 * All the rail's routing behavior lives on: last-path resume per section,
 * pushState fast-paths for layout-internal hops (with the server-rendered
 * exceptions), route + query-cache prewarming, the ⌘\ sidebar toggle, and
 * the activity/workflows/bookings badges.
 *
 * `variant="drawer"` renders the same tabs as a wrap-grid for the mobile
 * drawer (no brand/account chrome — the drawer header owns those).
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

type TabItem = {
  section: ShellSection;
  label: string;
  icon: typeof Bell;
  href?: string;
  routeKey?: string;
};

function resolveTarget(
  propertyId: string,
  item: TabItem,
): string | undefined {
  return lastSectionPath(propertyId, item.section) ?? item.href;
}

const IN_PROPERTY = /^\/p\/[^/]+\/[^/]+/;
const CHAT_ROOT = /^\/p\/[^/]+\/chat\/?$/;
const MEETINGS_ROUTE = /^\/p\/[^/]+\/meetings(\/.*)?$/;
const CHATBOTS_ROUTE = /^\/p\/[^/]+\/chatbots(\/.*)?$/;
const BOOKINGS_ROUTE = /^\/p\/[^/]+\/bookings(\/.*)?$/;
const FORMS_ROUTE = /^\/p\/[^/]+\/forms(\/.*)?$/;

/** Section tab — a 30px nav row laid out horizontally (notion-spec §4/§6):
 *  14px/500 secondary ink at rest, 6px radius, hover is FILL ONLY, and the
 *  active tab is that same fill at rest plus full ink. No pill, no ring, no
 *  bold, no color flip on hover. */
const tabClass =
  "group/tab flex h-[30px] shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium outline-hidden transition-colors " +
  "text-secondary-ink hover:bg-accent " +
  "data-current:bg-accent data-current:text-foreground " +
  "[&>svg]:text-faint-foreground data-current:[&>svg]:text-secondary-ink " +
  "focus-visible:shadow-focus";

type BarUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

export function AppTopBar({
  propertyId,
  userId,
  user,
  isManagement,
  variant = "bar",
  className,
}: {
  propertyId: string;
  userId: string;
  user: BarUser;
  isManagement: boolean;
  variant?: "bar" | "drawer";
  className?: string;
}) {
  const router = useRouter();
  // Mirror window.location the way the surfaces do — pushState hops don't
  // update `usePathname` (see documents-surface.tsx).
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

  const { data: workflows } = useQuery(workflowsListQueryOptions(propertyId));
  const failingWorkflows = useMemo(
    () =>
      (workflows ?? []).filter(
        (w) => w.enabled && w.last_run_status === "failed",
      ).length,
    [workflows],
  );
  const { data: pendingBookings = 0 } = useQuery(
    pendingBookingsCountQueryOptions(propertyId),
  );

  const items = useMemo<TabItem[]>(
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
        label: isManagement ? "Insights" : "My week",
        icon: LineChart,
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
  const moreActive = MORE_SECTIONS.has(section);
  const moreAlert = failingWorkflows > 0 || pendingBookings > 0;

  // Warm routes + section data caches (see the original rail for the why).
  useEffect(() => {
    for (const item of items) {
      const target = resolveTarget(propertyId, item);
      if (target) router.prefetch(target);
    }
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
  useEffect(() => {
    if (!client?.user) return;
    client.threads.activate();
  }, [client]);

  // ⌘\ sidebar toggle (only the real bar registers it — not the drawer copy).
  useEffect(() => {
    if (variant !== "bar") return;
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
  }, [variant, sidebarCollapsed, setSidebarCollapsed]);

  function handleClick(item: TabItem) {
    setSection(item.section);
    if (!item.href) return;
    const isChatPair = item.section === "chat" || item.section === "dms";
    const alreadyInSection = isChatPair
      ? section === item.section
      : !!item.routeKey &&
        pathname.includes(item.routeKey) &&
        !(item.section === "home" && pathname.includes("/home/insights"));
    if (alreadyInSection) return;
    const target = resolveTarget(propertyId, item);
    if (!target) return;

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
      window.dispatchEvent(new Event("hotelclaw:pathname"));
      return;
    }
    router.push(target);
  }

  function renderTab(item: TabItem) {
    const Icon = item.icon;
    const isActive = section === item.section;
    const activityCount =
      item.section === "activity" && unseenCount > 0 ? unseenCount : 0;
    const failingDot = item.section === "workflows" && failingWorkflows > 0;
    const pendingCount =
      item.section === "bookings" && pendingBookings > 0 ? pendingBookings : 0;
    return (
      <li key={item.section}>
        <button
          type="button"
          onClick={() => handleClick(item)}
          aria-current={isActive ? "page" : undefined}
          {...(isActive ? { "data-current": "" } : {})}
          className={tabClass}
        >
          <Icon className="size-4 shrink-0" strokeWidth={1.25} aria-hidden />
          {item.label}
          {activityCount > 0 ? (
            <CountBadge tone="brand">
              {activityCount > 9 ? "9+" : activityCount}
            </CountBadge>
          ) : null}
          {pendingCount > 0 ? (
            <CountBadge tone="warning-soft">
              {pendingCount > 9 ? "9+" : pendingCount}
            </CountBadge>
          ) : null}
          {failingDot ? (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-warning"
            />
          ) : null}
        </button>
      </li>
    );
  }

  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More sections"
        aria-current={moreActive ? "page" : undefined}
        {...(moreActive ? { "data-current": "" } : {})}
        className={cn(
          tabClass,
          "data-popup-open:bg-accent data-popup-open:text-foreground",
        )}
      >
        <MoreHorizontal className="size-4 shrink-0" strokeWidth={1.25} aria-hidden />
        More
        {moreAlert && !moreActive ? (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" sideOffset={6} className="w-64">
        {moreItems.map((item) => {
          const Icon = item.icon;
          const isActive = section === item.section;
          const failing = item.section === "workflows" && failingWorkflows > 0;
          const pending = item.section === "bookings" && pendingBookings > 0;
          return (
            <DropdownMenuItem
              key={item.section}
              onClick={() => handleClick(item)}
              aria-current={isActive ? "page" : undefined}
              className={cn("gap-2.5 px-2 py-2", isActive && "bg-accent")}
            >
              <Icon
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.25}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {item.label}
                  {failing ? (
                    <StatusBadge tone="warning" dot={false} className="tabular-nums">
                      {failingWorkflows} failing
                    </StatusBadge>
                  ) : null}
                  {pending ? (
                    <StatusBadge tone="warning" dot={false} className="tabular-nums">
                      {pendingBookings} pending
                    </StatusBadge>
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
  );

  if (variant === "drawer") {
    // Mobile drawer: same tabs, wrapped — the drawer header owns brand/account.
    return (
      <nav aria-label="Sections" className={className}>
        <ul role="list" className="flex flex-wrap gap-1">
          {primaryItems.map(renderTab)}
          <li>{moreMenu}</li>
        </ul>
      </nav>
    );
  }

  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 px-4",
        className,
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <BrandMark className="size-6" />
      </span>
      <nav
        aria-label="Sections"
        className="no-scrollbar min-w-0 flex-1 overflow-x-auto"
      >
        <ul role="list" className="flex items-center gap-1">
          {primaryItems.map(renderTab)}
          <li>{moreMenu}</li>
        </ul>
      </nav>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
          aria-pressed={sidebarCollapsed}
          title={`${sidebarCollapsed ? "Open" : "Close"} sidebar (⌘\\)`}
          className="text-muted-foreground hover:bg-accent"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={1.25} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={1.25} />
          )}
        </Button>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
