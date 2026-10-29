"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  useUnseenMentionsCount,
  useNotificationsRealtime,
} from "./use-unread-mentions";

/**
 * Sidebar entry for the mentions inbox — a gr8r `.sitem` row. Badge counts
 * UNSEEN mention notifications from our notifications table (matching what
 * /inbox displays). Reading the inbox marks those mentions seen and the
 * badge clears.
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
  const on = pathname.startsWith(href);

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
    <Link
      href={href}
      onClick={handleClick}
      className={on ? "sitem on" : "sitem"}
      title="Mentions"
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={AtSign} size={15} />
      <span className="trunc">Mentions</span>
      {unread > 0 ? (
        <span className="ct dotc">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Link>
  );
}
