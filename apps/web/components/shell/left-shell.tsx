"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CloseSidebarIcon } from "./clickup-icons";
import { useShellSection } from "./shell-section-context";
import { SectionSidebar } from "./section-sidebar";
import { LastPathRecorder } from "./last-path-recorder";
import { RouteTitle } from "./route-title";
import type { Membership } from "@/lib/auth/session";

/**
 * Sidebar width bounds. The default sits a touch under the measured Notion
 * sidebar width of 270 (docs/notion-spec.md §4) — per user preference,
 * 2026-08-15. The user can drag the right edge between MIN and MAX; dragging
 * well past MIN collapses the sidebar (Notion behavior), and the chosen width
 * persists in the `sidebar_width` cookie so the server can restore it on
 * first paint.
 */
export const DEFAULT_SIDEBAR_WIDTH = 250;
export const MIN_SIDEBAR_WIDTH = 200;
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
 * The whole left region: the one sidebar (see `SectionSidebar`) with its
 * resize handle, the collapse shortcut, and the » button that brings it back.
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
  // Collapse hides the sidebar fully (the original « / » behaviour — the
  // user preferred it over gr8r's 52px icon rail, 2026-10-29).
  const showSidebar = forceExpanded || (!sidebarHidden && !sidebarCollapsed);
  const rail = false;

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

  // Linear-style sidebar toggle — ⌘\ (Mac) / Ctrl\ (Win/Linux). Ignored while
  // typing so it doesn't swallow a literal backslash in an input/editor. The
  // desktop shell owns it; the mobile drawer copy must not double-bind.
  useEffect(() => {
    if (forceExpanded) return;
    function onKeyDown(e: KeyboardEvent) {
      // ⌘\ (Linear) or a bare `[` (gr8r).
      const bracket = e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!bracket && (e.key !== "\\" || !(e.metaKey || e.ctrlKey))) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA")
      ) {
        return;
      }
      e.preventDefault();
      setSidebarCollapsed(!sidebarCollapsed);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [forceExpanded, sidebarCollapsed, setSidebarCollapsed]);

  return (
    // `data-sidebar-open` lets the main pane (a following sibling styled with
    // `peer-data-[sidebar-open]:…`) react to the sidebar being attached.
    <div
      data-sidebar-open={showSidebar ? "" : undefined}
      className={cn("relative flex shrink-0 flex-col bg-sidebar", className)}
    >
      {/* Records each section's last route to localStorage so the sidebar
          and property switcher can jump straight back to it. Renders nothing. */}
      <LastPathRecorder propertyId={currentPropertyId} />
      {/* Route-aware document.title. Renders nothing. */}
      {!forceExpanded && <RouteTitle propertyId={currentPropertyId} />}
      {(forceExpanded || !sidebarHidden) && (
        // Width slot that animates open/closed (ClickUp-style slide). The
        // sidebar stays MOUNTED while collapsed — the slot just shrinks to
        // 0 and clips it — so reopening is instant and keeps scroll/data
        // state. `inert` keeps the clipped sidebar out of the tab order.
        // No transition mid-drag, or resizing would lag the cursor. In the
        // mobile drawer the slot dissolves (`contents`) and the sidebar
        // goes full-width as before.
        <div
          inert={!showSidebar}
          className={cn(
            "flex min-h-0 flex-1 max-md:contents md:w-(--sidebar-slot-width) md:overflow-hidden",
            !dragging &&
              "md:transition-[width] md:duration-200 md:ease-out motion-reduce:transition-none",
          )}
          style={
            {
              "--sidebar-slot-width": !showSidebar
                ? "0px"
                : rail
                  ? "52px"
                  : `${width}px`,
            } as React.CSSProperties
          }
        >
          <SectionSidebar
            currentPropertyId={currentPropertyId}
            memberships={memberships}
            user={user}
            width={rail ? 52 : width}
            collapsed={rail}
          />
        </div>
      )}
      {showSidebar && !rail && !forceExpanded && (
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
      {!showSidebar && !forceExpanded && (
        // Linear's » at the top-left of the page while the sidebar is
        // hidden: the one piece of shell that survives a collapse. Fixed so
        // it escapes the zero-width slot; quiet (fill on hover only).
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Open sidebar"
                  className="fixed top-2 left-2 z-30 flex size-[30px] items-center justify-center rounded-md text-faint-foreground outline-hidden transition-colors hover:bg-accent hover:text-secondary-ink focus-visible:shadow-focus max-md:hidden"
                >
                  {/* ClickUp's closeLeft glyph, mirrored to point at the sidebar. */}
                  <CloseSidebarIcon className="size-4 -scale-x-100" />
                </button>
              }
            />
            <TooltipContent side="right">
              Open sidebar
              <kbd className="ml-1.5 font-sans text-xs font-normal opacity-60">
                ⌘\
              </kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
