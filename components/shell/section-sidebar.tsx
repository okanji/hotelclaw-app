"use client";

import { Suspense } from "react";
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
import { DocumentsTreeSection } from "@/components/documents/documents-tree-section";
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
        {section === "activity" ? (
          <Suspense fallback={null}>
            <ActivitySection
              propertyId={currentPropertyId}
              userId={user.id}
            />
          </Suspense>
        ) : null}
        {section === "chat" ? (
          <ChatSection
            propertyId={currentPropertyId}
            userId={user.id}
            isChannelAdmin={isChannelAdmin}
          />
        ) : null}
        {section === "dms" ? (
          <DmsSection propertyId={currentPropertyId} userId={user.id} />
        ) : null}
        {section === "tasks" ? (
          <Suspense fallback={null}>
            <TasksSection propertyId={currentPropertyId} />
          </Suspense>
        ) : null}
        {section === "docs" ? (
          <DocumentsTreeSection propertyId={currentPropertyId} />
        ) : null}
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
