"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/shell/use-notifications";
import {
  FILTER_VIEWS,
  PRIMARY_VIEWS,
  matchesView,
  viewFromParam,
  type ActivityViewId,
} from "@/components/shell/activity/views";

/**
 * Activity secondary sidebar — the inbox's FILTER NAV (not a feed). Each item
 * scopes the main-pane feed via `?view=<id>`; the badge is that view's unread
 * count. This is the one list of "where to look"; the rows themselves live
 * only in the main pane, so the two panes no longer duplicate each other.
 */
export function ActivitySection({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { notifications, unseenCount } = useNotifications(userId);
  const { markAllRead } = useNotificationActions(userId);

  const base = `/p/${propertyId}/activity`;
  const onActivity = pathname === base || pathname.startsWith(`${base}/`);
  const active: ActivityViewId = onActivity
    ? viewFromParam(searchParams.get("view"))
    : "inbox";

  /** Unread count per view — the actionable number shown as a badge. */
  const unreadByView = useMemo(() => {
    const counts = {} as Record<ActivityViewId, number>;
    for (const v of [...PRIMARY_VIEWS, ...FILTER_VIEWS]) counts[v.id] = 0;
    for (const n of notifications) {
      if (n.seen_at) continue;
      for (const v of [...PRIMARY_VIEWS, ...FILTER_VIEWS]) {
        if (matchesView(n, v.id)) counts[v.id] += 1;
      }
    }
    return counts;
  }, [notifications]);

  const go = useCallback(
    (view: ActivityViewId) => {
      router.replace(view === "inbox" ? base : `${base}?view=${view}`, {
        scroll: false,
      });
    },
    [router, base],
  );

  return (
    <>
      <SidebarGroup>
        {/* The rail already names the section, so this is a 12px/12px w500
            faint group label like every other sidebar group — not a display
            heading (notion-spec §3). The mark-all-read affordance sits
            right-aligned in the same row. */}
        <div className="flex items-center justify-between">
          <SidebarGroupLabel>Activity</SidebarGroupLabel>
          {unseenCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Mark all read"
              onClick={markAllRead}
              className="text-faint-foreground hover:bg-sidebar-accent"
            >
              <CheckCheck className="size-4" />
            </Button>
          ) : null}
        </div>
        <SidebarGroupContent>
          <SidebarMenu>
            {PRIMARY_VIEWS.map((v) => (
              <SidebarMenuItem key={v.id}>
                <SidebarMenuButton
                  render={<button type="button" />}
                  onClick={() => go(v.id)}
                  isActive={active === v.id}
                  tooltip={v.label}
                >
                  <v.icon />
                  <span>{v.label}</span>
                </SidebarMenuButton>
                {unreadByView[v.id] > 0 ? (
                  <SidebarMenuBadge>{unreadByView[v.id]}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Filters</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {FILTER_VIEWS.map((v) => (
              <SidebarMenuItem key={v.id}>
                <SidebarMenuButton
                  render={<button type="button" />}
                  onClick={() => go(v.id)}
                  isActive={active === v.id}
                  tooltip={v.label}
                >
                  <v.icon
                    className={cn(
                      v.attention && "text-warning",
                    )}
                  />
                  <span>{v.label}</span>
                </SidebarMenuButton>
                {unreadByView[v.id] > 0 ? (
                  <SidebarMenuBadge
                    className={cn(v.attention && "bg-warning")}
                  >
                    {unreadByView[v.id]}
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
