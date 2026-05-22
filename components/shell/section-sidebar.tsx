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
import { ActivitySection } from "./sections/activity-section";
import { ChatSection } from "./sections/chat-section";
import { DmsSection } from "./sections/dms-section";
import { TasksSection } from "./sections/tasks-section";
import { CalendarSection } from "@/components/calendar/calendar-section";
import { DocumentsTreeSection } from "@/components/documents/documents-tree-section";
import { MeetingsSection } from "./sections/meetings-section";
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
  /** Width (px) — owned by `LeftShell` so the user-menu footer can match it. */
  width: number;
  dragging: boolean;
  handleProps: ResizeHandleProps;
};

/**
 * The second sidebar — content swaps with the active rail section. Property
 * switcher header + section content + drag-to-resize handle. The user-menu
 * footer lives in `LeftShell` instead, so it can span the app's left edge.
 */
export function SectionSidebar({
  currentPropertyId,
  memberships,
  user,
  width,
  dragging,
  handleProps,
}: Props) {
  const { section } = useShellSection();

  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isChannelAdmin = currentRole === "owner" || currentRole === "manager";

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col bg-sidebar"
      style={{ width }}
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
        {/* All five sections stay mounted; only visibility toggles. Each
            loads its data once (on property entry), so switching the rail is
            an instant show/hide — no remount, no re-fetch, no skeleton. */}
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
        <SectionPane active={section === "meetings"}>
          <MeetingsSection propertyId={currentPropertyId} />
        </SectionPane>
      </SidebarContent>

      {/* Drag-to-resize handle on the trailing edge. */}
      <div
        {...handleProps}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className="group/resize absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none"
      >
        <span
          className={cn(
            "absolute inset-y-0 right-0 w-px transition-colors",
            dragging
              ? "bg-primary/60"
              : "bg-transparent group-hover/resize:bg-sidebar-border",
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
