"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useUnreadCount } from "./use-unread-count";

/**
 * Sidebar entry for the inbox. Shows a small badge with the user's total
 * unread count when > 0. We use Stream's `total_unread_count` rather than a
 * mentions-only count because Stream doesn't expose unread-mentions
 * client-side; this gives a useful general signal.
 */
export function InboxSidebarLink({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const unread = useUnreadCount();
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
