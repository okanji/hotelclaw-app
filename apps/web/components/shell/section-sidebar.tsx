"use client";

import { Suspense, type ReactNode } from "react";
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { PropertySwitcher } from "./property-switcher";
import { SearchButton } from "./search-button";
import { useShellSection } from "./shell-section-context";
import { HomeSection } from "./sections/home-section";
import { InsightsSection } from "./sections/insights-section";
import { ActivitySection } from "./sections/activity-section";
import { ChatSection } from "./sections/chat-section";
import { DmsSection } from "./sections/dms-section";
import { TasksSection } from "./sections/tasks-section";
import { CalendarSection } from "@/components/calendar/calendar-section";
import { DocumentsTreeSection } from "@/components/documents/documents-tree-section";
import { MeetingsSection } from "./sections/meetings-section";
import { WorkflowsSection } from "./sections/workflows-section";
import { ChatbotsSection } from "./sections/chatbots-section";
import { BookingsSection } from "./sections/bookings-section";
import type { Membership } from "@/lib/auth/session";

type Props = {
  currentPropertyId: string;
  memberships: Membership[];
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
  /** Width (px) — owned by `LeftShell`. */
  width: number;
};

/**
 * The second sidebar — content swaps with the active rail section. Property
 * switcher header + section content. Collapsed/opened via the rail button.
 */
export function SectionSidebar({
  currentPropertyId,
  memberships,
  user,
  width,
}: Props) {
  const { section } = useShellSection();

  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isChannelAdmin = currentRole === "owner" || currentRole === "manager";

  return (
    <aside
      // Full-height left hairline — the rail↔sidebar partition: both panels
      // share `bg-sidebar`, so this line is the only thing separating them.
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar"
      style={{ width }}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* pt-3 (not the default p-2): the sidebar sits flush at the shell top
          while the rail and main pane are inset by m-2, so the extra 4px drops
          the property switcher's center onto the page-header title line for a
          continuous top bar across the seam. */}
      <SidebarHeader className="pt-3">
        <PropertySwitcher
          currentPropertyId={currentPropertyId}
          memberships={memberships}
          email={user.email}
        />
        <SidebarMenu>
          <SearchButton />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* All sections stay mounted; only visibility toggles. Each loads its
            data once (on property entry), so switching the rail is an instant
            show/hide — no remount, no re-fetch, no skeleton. */}
        <SectionPane active={section === "home"}>
          <HomeSection propertyId={currentPropertyId} />
        </SectionPane>
        <SectionPane active={section === "insights"}>
          <InsightsSection
            propertyId={currentPropertyId}
            isManagement={isChannelAdmin}
          />
        </SectionPane>
        <SectionPane active={section === "activity"}>
          <Suspense fallback={null}>
            <ActivitySection propertyId={currentPropertyId} userId={user.id} />
          </Suspense>
        </SectionPane>
        <SectionPane active={section === "chat"}>
          <ChatSection
            propertyId={currentPropertyId}
            userId={user.id}
            isChannelAdmin={isChannelAdmin}
          />
        </SectionPane>
        <SectionPane active={section === "dms"}>
          <DmsSection propertyId={currentPropertyId} userId={user.id} />
        </SectionPane>
        <SectionPane active={section === "tasks"}>
          <Suspense fallback={null}>
            <TasksSection propertyId={currentPropertyId} />
          </Suspense>
        </SectionPane>
        <SectionPane active={section === "calendar"}>
          <CalendarSection propertyId={currentPropertyId} />
        </SectionPane>
        <SectionPane active={section === "docs"}>
          <DocumentsTreeSection propertyId={currentPropertyId} />
        </SectionPane>
        <SectionPane active={section === "workflows"}>
          <Suspense fallback={null}>
            <WorkflowsSection propertyId={currentPropertyId} />
          </Suspense>
        </SectionPane>
        <SectionPane active={section === "meetings"}>
          <MeetingsSection propertyId={currentPropertyId} />
        </SectionPane>
        <SectionPane active={section === "chatbots"}>
          <Suspense fallback={null}>
            <ChatbotsSection propertyId={currentPropertyId} />
          </Suspense>
        </SectionPane>
        <SectionPane active={section === "bookings"}>
          <Suspense fallback={null}>
            <BookingsSection propertyId={currentPropertyId} />
          </Suspense>
        </SectionPane>
      </SidebarContent>
      </div>
    </aside>
  );
}

/**
 * Wraps one section so all five can stay mounted simultaneously. The active
 * section renders transparently (`display: contents`, so its `SidebarGroup`s
 * lay out as direct children of `SidebarContent`, exactly as before); the rest
 * are `display: none` but still mounted — keeping their data, subscriptions
 * and scroll position warm so a rail switch is instant, with no loading state.
 */
function SectionPane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return <div className={active ? "contents" : "hidden"}>{children}</div>;
}
