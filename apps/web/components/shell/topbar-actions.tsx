"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Bell, Search } from "lucide-react";
import { useViewerId } from "@/components/activity/activity-log";
import { useCommandPalette } from "./command-palette-context";
import { useNotifications } from "./use-notifications";
import { Gi } from "@/components/gr8r/icon";
import { NewMenu } from "./new-menu";

/**
 * gr8r-studio topbar right cluster (SPEC §2.3, 2026-10-29): the 220px
 * "Search or jump to…" trigger (our ⌘K palette), the bell with an accent
 * unread dot (→ Notifications), and the `New ▾` create menu. Rendered by
 * `PageHeader` on every property page, after the page's own actions.
 */
export function TopbarActions() {
  const params = useParams<{ propertyId?: string }>();
  const propertyId = params?.propertyId;
  const viewerId = useViewerId();
  const { toggle } = useCommandPalette();
  if (!propertyId) return null;
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return (
    <>
      <button type="button" className="topsearch" onClick={toggle} aria-label="Search and commands">
        <Gi icon={Search} size={14} />
        <span className="lbltxt">Search or jump to…</span>
        <span className="kbd">{mac ? "⌘K" : "Ctrl K"}</span>
      </button>
      {viewerId ? <TopbarBell propertyId={propertyId} userId={viewerId} /> : null}
      <NewMenu propertyId={propertyId} variant="button" />
    </>
  );
}

/** Mounted only once the viewer is known — the hook subscribes per user. */
function TopbarBell({
  propertyId,
  userId,
}: {
  propertyId: string;
  userId: string;
}) {
  const { unseenCount } = useNotifications(userId);
  return (
    <Link
      href={`/p/${propertyId}/activity?view=unread`}
      className="ibtn"
      title="Notifications"
      aria-label={unseenCount > 0 ? `Notifications, ${unseenCount} unread` : "Notifications"}
    >
      <Gi icon={Bell} />
      {unseenCount > 0 ? (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 7,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--g8-accent)",
            boxShadow: "0 0 0 2px var(--g8-surface)",
          }}
        />
      ) : null}
    </Link>
  );
}
