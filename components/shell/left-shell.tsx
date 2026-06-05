"use client";

import { useCallback } from "react";
import { useShellSection } from "./shell-section-context";
import { useResizableAside } from "./use-resizable-aside";
import { AppRail } from "./app-rail";
import { SectionSidebar } from "./section-sidebar";
import { LastPathRecorder } from "./last-path-recorder";
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
 * The whole left region: icon rail (with account menu) + secondary sidebar.
 * Every rail section — Activity included — renders its content in the
 * secondary sidebar.
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
  const { section, sidebarHidden, setSidebarHidden } = useShellSection();
  const collapse = useCallback(
    () => setSidebarHidden(true),
    [setSidebarHidden],
  );
  const standard = useResizableAside(defaultWidth, STANDARD_WIDTH, {
    onCollapse: collapse,
  });
  const activity = useResizableAside(activityDefaultWidth, ACTIVITY_WIDTH, {
    cookieName: "activity_sidebar_width",
    onCollapse: collapse,
  });
  const resize = section === "activity" ? activity : standard;

  return (
    <div className="flex shrink-0 flex-col bg-sidebar">
      {/* Records each section's last route to localStorage so the rail and
          property switcher can jump straight back to it. Renders nothing. */}
      <LastPathRecorder propertyId={currentPropertyId} />
      <div className="flex min-h-0 flex-1">
        <AppRail
          propertyId={currentPropertyId}
          userId={user.id}
          user={user}
        />
        {!sidebarHidden && (
          <SectionSidebar
            currentPropertyId={currentPropertyId}
            memberships={memberships}
            user={user}
            width={resize.width}
            dragging={resize.dragging}
            tooSmall={resize.tooSmall}
            collapsing={resize.collapsing}
            handleProps={resize.handleProps}
          />
        )}
      </div>
    </div>
  );
}
