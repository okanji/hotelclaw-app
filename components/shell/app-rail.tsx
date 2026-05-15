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
import { cn } from "@/lib/utils";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { useNotifications } from "./use-notifications";

type RailItem = {
  section: ShellSection;
  label: string;
  icon: typeof Bell;
  /** Landing route pushed on click. Omitted for DMs (no index route). */
  href?: string;
  /** Pathname fragment meaning "already inside this section". */
  routeKey?: string;
};

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
        routeKey: "/chat",
      },
      {
        section: "dms",
        label: "DMs",
        icon: MessageCircle,
        // DMs share the `/chat/*` routes with channels — navigate there (only
        // when off it) so DMs is never left showing a non-chat page.
        href: `/p/${propertyId}/chat`,
        routeKey: "/chat",
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
  // a chat channel briefly showing under the Activity rail.
  useEffect(() => {
    for (const item of items) {
      if (item.href) router.prefetch(item.href);
    }
  }, [items, router]);

  function handleClick(item: RailItem) {
    setSection(item.section);
    // Navigate to the section's landing route — unless we're already on a
    // route that belongs to it (don't yank the user off their current page).
    if (item.href && !(item.routeKey && pathname.includes(item.routeKey))) {
      router.push(item.href);
    }
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
