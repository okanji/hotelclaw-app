"use client";

import { cn } from "@/lib/utils";
import { useShellSection } from "./shell-section-context";
import { AppRail } from "./app-rail";
import { SectionSidebar } from "./section-sidebar";
import { LastPathRecorder } from "./last-path-recorder";
import type { Membership } from "@/lib/auth/session";

/**
 * Fixed width for the secondary sidebar — uniform across sections (Activity is
 * now filter nav, not a notification feed, so it no longer needs extra room).
 * The sidebar is collapsed/opened via the rail button, not drag-resizable.
 *
 * 270px is the measured Notion sidebar width (docs/notion-spec.md §4): 8px
 * inner padding on each side leaves 254px-wide rows.
 */
const STANDARD_WIDTH = 270;

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
  className,
  forceExpanded = false,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  user: User;
  className?: string;
  /** Inside the mobile drawer the sidebar always shows, ignoring the
      desktop collapse/hide state. */
  forceExpanded?: boolean;
}) {
  const { sidebarHidden, sidebarCollapsed } = useShellSection();
  const showSidebar = forceExpanded || (!sidebarHidden && !sidebarCollapsed);

  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isManagement = currentRole === "owner" || currentRole === "manager";

  return (
    // `data-sidebar-open` lets the main pane (a following sibling styled with
    // `peer-data-[sidebar-open]:…`) react to the sidebar being attached.
    // Transparent root: the rail and the sidebar each paint their own plane
    // and sit flush against one another (no gutters, no rounded cards — see
    // docs/notion-spec.md §1); the mobile drawer's SheetContent paints its
    // own bg-sidebar.
    <div
      data-sidebar-open={showSidebar ? "" : undefined}
      className={cn("flex shrink-0 flex-col", className)}
    >
      {/* Records each section's last route to localStorage so the rail and
          property switcher can jump straight back to it. Renders nothing. */}
      <LastPathRecorder propertyId={currentPropertyId} />
      <div className="flex min-h-0 flex-1">
        <AppRail
          propertyId={currentPropertyId}
          userId={user.id}
          user={user}
          memberships={memberships}
          isManagement={isManagement}
        />
        {showSidebar && (
          <SectionSidebar
            currentPropertyId={currentPropertyId}
            memberships={memberships}
            user={user}
            width={STANDARD_WIDTH}
          />
        )}
      </div>
    </div>
  );
}
