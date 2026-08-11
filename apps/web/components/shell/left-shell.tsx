"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useShellSection } from "./shell-section-context";
import { AppRail } from "./app-rail";
import { SectionSidebar } from "./section-sidebar";
import { LastPathRecorder } from "./last-path-recorder";
import type { Membership } from "@/lib/auth/session";

/**
 * Secondary-sidebar width bounds. The default is the measured Notion sidebar
 * width (docs/notion-spec.md §4): 8px inner padding on each side leaves
 * 254px-wide rows. The user can drag the right edge between MIN and MAX;
 * dragging well past MIN collapses the sidebar (Notion behavior), and the
 * chosen width persists in the `sidebar_width` cookie so the server can
 * restore it on first paint.
 */
export const DEFAULT_SIDEBAR_WIDTH = 270;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 480;
/** Raw drag position below this (unclamped) collapses instead of resizing. */
const COLLAPSE_BELOW = 150;

export function clampSidebarWidth(w: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(w, MAX_SIDEBAR_WIDTH));
}

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
  initialSidebarWidth = DEFAULT_SIDEBAR_WIDTH,
}: {
  currentPropertyId: string;
  memberships: Membership[];
  user: User;
  className?: string;
  /** Inside the mobile drawer the sidebar always shows, ignoring the
      desktop collapse/hide state. */
  forceExpanded?: boolean;
  /** Width restored server-side from the `sidebar_width` cookie so the first
      paint already matches (no jump). */
  initialSidebarWidth?: number;
}) {
  const { sidebarHidden, sidebarCollapsed, setSidebarCollapsed } =
    useShellSection();
  const showSidebar = forceExpanded || (!sidebarHidden && !sidebarCollapsed);

  const [width, setWidth] = useState(() =>
    clampSidebarWidth(initialSidebarWidth),
  );
  const [dragging, setDragging] = useState(false);
  // Raw (unclamped) drag width — read on release to decide drag-to-collapse.
  const dragState = useRef<{ startX: number; startWidth: number; raw: number } | null>(
    null,
  );
  // Manual double-press detection: preventDefault on pointerdown suppresses
  // the compatibility mouse events, so a `dblclick` handler never fires.
  const lastPointerDown = useRef(0);

  const persistWidth = useCallback((w: number) => {
    document.cookie = `sidebar_width=${w}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const now = e.timeStamp;
      if (now - lastPointerDown.current < 400) {
        // Double-press → reset to the default width.
        lastPointerDown.current = 0;
        dragState.current = null;
        setWidth(DEFAULT_SIDEBAR_WIDTH);
        persistWidth(DEFAULT_SIDEBAR_WIDTH);
        return;
      }
      lastPointerDown.current = now;
      dragState.current = { startX: e.clientX, startWidth: width, raw: width };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width, persistWidth],
  );
  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      // The handle sits on the sidebar's RIGHT edge — dragging right widens.
      drag.raw = drag.startWidth + (e.clientX - drag.startX);
      setWidth(clampSidebarWidth(drag.raw));
    },
    [],
  );
  const onHandlePointerUp = useCallback(() => {
    const drag = dragState.current;
    dragState.current = null;
    setDragging(false);
    if (!drag) return;
    if (drag.raw < COLLAPSE_BELOW) {
      // Dragged well past the minimum → collapse (Notion behavior). Keep the
      // pre-drag width so reopening restores a sane size.
      setWidth(drag.startWidth);
      setSidebarCollapsed(true);
    } else {
      persistWidth(clampSidebarWidth(drag.raw));
    }
  }, [persistWidth, setSidebarCollapsed]);

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
      className={cn("relative flex shrink-0 flex-col", className)}
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
            width={width}
          />
        )}
      </div>
      {showSidebar && !forceExpanded && (
        // Drag-to-resize handle over the sidebar's right edge (the root's
        // right edge — the sidebar is the last flex child). Wider hit area
        // than the 1px edge shadow; pointer capture keeps the drag alive when
        // the cursor outruns the handle. Desktop only — the mobile drawer
        // renders the sidebar full-width.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize transition-colors max-md:hidden",
            dragging ? "bg-ring" : "hover:bg-border",
          )}
        />
      )}
      {dragging && (
        // While dragging, blanket the viewport so iframes/editors under the
        // cursor can't swallow the pointermove stream, and text doesn't get
        // selected mid-drag.
        <div className="fixed inset-0 z-50 cursor-col-resize select-none" />
      )}
    </div>
  );
}
