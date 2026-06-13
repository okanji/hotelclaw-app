"use client";

import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { PropertySwitcher } from "./property-switcher";
import { SearchButton } from "./search-button";
import { useShellSection } from "./shell-section-context";
import { HomeSection } from "./sections/home-section";
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

type ResizeHandleProps = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
};

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
  dragging: boolean;
  /** Dragged below `min` — content fades to signal "release to collapse". */
  tooSmall: boolean;
  /** Spring-collapse in flight — content blurs as the width springs to zero. */
  collapsing: boolean;
  handleProps: ResizeHandleProps;
};

/**
 * The second sidebar — content swaps with the active rail section. Property
 * switcher header + section content + drag-to-resize handle.
 */
export function SectionSidebar({
  currentPropertyId,
  memberships,
  user,
  width,
  dragging,
  tooSmall,
  collapsing,
  handleProps,
}: Props) {
  const { section } = useShellSection();

  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isChannelAdmin = currentRole === "owner" || currentRole === "manager";

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden bg-sidebar"
      style={{ width }}
    >
      {/* Content fades in the too-small zone and blurs as the spring-collapse
          runs (ported from the prototype's aside-content treatment). The resize
          handle below stays outside this wrapper so it remains draggable. */}
      <div
        data-too-small={tooSmall ? "" : undefined}
        data-collapsing={collapsing ? "" : undefined}
        className="flex min-h-0 w-full flex-1 flex-col transition-[filter,opacity] duration-500 ease-out data-collapsing:blur-[5px] data-too-small:pointer-events-none data-too-small:opacity-30"
      >
      <SidebarHeader>
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
          <HomeSection
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

      {/* Drag-to-resize handle on the trailing edge. The prototype's pill
          indicator sits centered on the seam and brightens on hover/drag;
          drag it narrow to fade the content, release there to spring it shut. */}
      <div
        {...handleProps}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className="group/resize absolute inset-y-0 right-0 z-20 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
      >
        <span
          className={cn(
            "h-6 w-1 rounded-full transition-colors",
            dragging
              ? "bg-contrast-high/25"
              : "bg-contrast-high/10 group-hover/resize:bg-contrast-high/20",
          )}
        />
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
