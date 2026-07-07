"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  useUnseenMentionsCount,
  useNotificationsRealtime,
} from "./use-unread-mentions";

/**
 * Sidebar entry for the inbox. Badge counts UNSEEN mention notifications
 * from our notifications table (matching what /inbox displays). Reading
 * the inbox marks those mentions seen and the badge clears.
 */
export function InboxSidebarLink({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const pathname = usePathname();
  const unread = useUnseenMentionsCount(userId);
  useNotificationsRealtime(userId);
  const href = `/p/${propertyId}/inbox`;

  // `inbox/page.tsx` is null and `<InboxSurface>` in the property layout
  // owns rendering, so clicking is a zero-roundtrip `pushState` like channel
  // switching. Modifier-clicks fall through so "open in new tab" still works.
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("hotelclaw:pathname"));
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} onClick={handleClick} />}
        isActive={pathname.startsWith(href)}
        tooltip="Inbox"
      >
        <Inbox />
        <span>Inbox</span>
        {unread > 0 ? (
          <span className="ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-xs font-medium leading-none text-sidebar-foreground/70 tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
