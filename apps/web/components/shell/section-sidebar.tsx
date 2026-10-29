"use client";

import { cn } from "@/lib/utils";
import { Gr8rSidebarBoundary } from "./gr8r-sidebar";
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
  /** gr8r's 52px icon rail. */
  collapsed?: boolean;
};

/**
 * THE sidebar slot. The sidebar itself is gr8r-studio's (`gr8r-sidebar.tsx`,
 * classes from `app/gr8r.css`); this wrapper owns the width the shell hands
 * it and gr8r's `.collapsed` 52px rail state.
 */
export function SectionSidebar({
  currentPropertyId,
  memberships,
  user,
  width,
  collapsed = false,
}: Props) {
  return (
    <aside
      data-section-sidebar=""
      className={cn(
        "group/section-sidebar relative flex shrink-0 flex-col overflow-hidden max-md:h-full max-md:w-full md:w-(--section-sidebar-width)",
        collapsed && "collapsed",
      )}
      style={{ "--section-sidebar-width": `${width}px` } as React.CSSProperties}
    >
      <Gr8rSidebarBoundary
        currentPropertyId={currentPropertyId}
        memberships={memberships}
        user={user}
        collapsed={collapsed}
      />
    </aside>
  );
}
