"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useNotifications } from "@/components/shell/use-notifications";
import {
  unreadCountsByView,
  viewDef,
  viewFromParam,
  type ActivityViewId,
} from "@/components/shell/activity/views";

/** The few inbox cuts worth a sidebar shortcut; the page tabs have them all. */
// No "Mentions" here: Chat's node already has a Mentions row (the @-feed),
// and two same-named rows a few lines apart read as a duplicate. The inbox's
// mention filter is one tab away in the page header.
const SHORTCUTS: ActivityViewId[] = ["unread", "workspace"];

/**
 * Inbox node body — destinations only. The full filter strip, Mark all as
 * read, and per-row actions live in the inbox page header
 * (`activity/activity-view.tsx`), because this body is hidden whenever the
 * row is collapsed. These are shortcuts into the same `?view=` URLs.
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
  const { notifications } = useNotifications(userId);

  const base = `/p/${propertyId}/activity`;
  const onActivity = pathname === base || pathname.startsWith(`${base}/`);
  const active: ActivityViewId | null = onActivity
    ? viewFromParam(searchParams.get("view"))
    : null;

  const unreadByView = useMemo(
    () => unreadCountsByView(notifications),
    [notifications],
  );

  const go = useCallback(
    (view: ActivityViewId) => {
      router.replace(`${base}?view=${view}`, { scroll: false });
    },
    [router, base],
  );

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {SHORTCUTS.map((id) => {
            const v = viewDef(id);
            return (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton
                  render={<button type="button" />}
                  onClick={() => go(id)}
                  isActive={active === id}
                  tooltip={v.label}
                >
                  <v.icon />
                  <span>{v.label}</span>
                </SidebarMenuButton>
                {unreadByView[id] > 0 ? (
                  <SidebarMenuBadge>{unreadByView[id]}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
