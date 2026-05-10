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

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={pathname.startsWith(href)}
        tooltip="Inbox"
      >
        <Inbox />
        <span>Inbox</span>
        {unread > 0 ? (
          <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
