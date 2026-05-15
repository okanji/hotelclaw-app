"use client";

import { useShellSection } from "./shell-section-context";
import { useResizableWidth } from "./use-resizable-width";
import { AppRail } from "./app-rail";
import { SectionSidebar } from "./section-sidebar";
import { UserMenu } from "./user-menu";
import type { Membership } from "@/lib/auth/session";

/**
 * Resize bounds for the secondary sidebar. Activity is wider by default — its
 * notification cards need more room than a list of channel names — and keeps
 * its own persisted width separate from the chat/tasks/docs sidebar.
 */
const STANDARD_WIDTH = { min: 160, max: 480, fallback: 224 };
const ACTIVITY_WIDTH = { min: 280, max: 560, fallback: 380 };

type User = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * The whole left region: icon rail + secondary sidebar on top, with the
 * user-menu footer spanning their full width along the bottom so it sits
 * flush with the app's left edge (under the rail). Every rail section —
 * Activity included — renders its content in the secondary sidebar.
 */
export function LeftShell({
  currentPropertyId,
  memberships,
  user,
  defaultWidth,
  activityDefaultWidth,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  user: User;
  defaultWidth?: number;
  activityDefaultWidth?: number;
}) {
  const { section } = useShellSection();
  const standard = useResizableWidth(defaultWidth, STANDARD_WIDTH);
  const activity = useResizableWidth(
    activityDefaultWidth,
    ACTIVITY_WIDTH,
    "activity_sidebar_width",
  );
  const resize = section === "activity" ? activity : standard;

  return (
    <div className="flex shrink-0 flex-col bg-sidebar">
      <div className="flex min-h-0 flex-1">
        <AppRail propertyId={currentPropertyId} userId={user.id} />
        <SectionSidebar
          currentPropertyId={currentPropertyId}
          memberships={memberships}
          user={user}
          width={resize.width}
          dragging={resize.dragging}
          handleProps={resize.handleProps}
        />
      </div>
      <UserMenu user={user} />
    </div>
  );
}
