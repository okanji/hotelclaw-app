"use client";

import { useMemo } from "react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CloseSidebarIcon } from "./clickup-icons";
import { PropertySwitcher } from "./property-switcher";
import { SearchButton } from "./search-button";
import { FavoritesGroup, NewMenu, YouBlock } from "./you-block";
import { WorkspaceNav } from "./workspace-nav";
import { UserMenu } from "./user-menu";
import { defaultPins } from "./nav-apps";
import { useNavPrefs } from "./use-nav-prefs";
import { useShellSection } from "./shell-section-context";
import { ProjectsSidebar } from "@/components/projects/projects-sidebar";
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
 * THE sidebar — one tree, Linear / ClickUp style (the Slack-style icon rail
 * is gone, 2026-10-25): property switcher + search + create up top, then the
 * personal block (Inbox / My tasks / Assistant), the PINNED Workspace apps +
 * the More launcher (`workspace-nav.tsx`), Favorites, the Teams + Projects
 * lists, and the account menu in the footer. Nodes expand independently; a
 * click moves the lit row and opens the node it landed in. What's pinned and
 * which lower groups show is the person's Customize-sidebar choice.
 */
export function SectionSidebar({
  currentPropertyId,
  memberships,
  user,
  width,
}: Props) {
  const currentRole = memberships.find(
    (m) => m.property_id === currentPropertyId,
  )?.role;
  const isManagement = currentRole === "owner" || currentRole === "manager";
  const defaults = useMemo(() => defaultPins(isManagement), [isManagement]);
  const { hidden } = useNavPrefs(defaults);

  return (
    <aside
      data-section-sidebar=""
      // Notion's sidebar is a FLUSH plane, not a detached rounded card: it
      // runs full height against the content pane on its right, and its only
      // separation is a 1px warm inset shadow on that edge (docs/notion-spec.md
      // §2 — "a shadow, not a border"). No margin, no radius, no stroke. Width
      // arrives as a custom property so the mobile drawer can override it
      // with `max-md:w-full`.
      className="group/section-sidebar relative flex shrink-0 flex-col overflow-hidden bg-sidebar shadow-(--sidebar-edge-shadow) max-md:h-full max-md:w-full max-md:shadow-none md:w-(--section-sidebar-width)"
      style={
        { "--section-sidebar-width": `${width}px` } as React.CSSProperties
      }
    >
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {/* 8px inner padding is the sidebar's single horizontal rhythm — the
            same inset the rows and group labels use (notion-spec §4). */}
        {/* The header breathes more than the rows below it: 10px between the
            switcher and Search, 16px before the first nav row, so the
            workspace identity and the search/create row read as their own
            band rather than as the first two items of the list. */}
        <SidebarHeader className="gap-2.5 px-2 pt-2 pb-4">
          <div className="flex items-center gap-0.5">
            <PropertySwitcher
              currentPropertyId={currentPropertyId}
              memberships={memberships}
              email={user.email}
            />
            <SidebarCollapseButton />
          </div>
          {/* Search + the global create menu share one row. */}
          <div className="flex items-center gap-0.5">
            <SidebarMenu className="min-w-0 flex-1">
              <SearchButton />
            </SidebarMenu>
            <NewMenu propertyId={currentPropertyId} />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <YouBlock propertyId={currentPropertyId} userId={user.id} />
          <WorkspaceNav
            propertyId={currentPropertyId}
            userId={user.id}
            isManagement={isManagement}
          />
          {hidden.includes("favorites") ? null : (
            <FavoritesGroup propertyId={currentPropertyId} />
          )}
          {/* Teams + Projects as destinations (Linear's "Your teams"): each
              row expands into its workspace views. */}
          <ProjectsSidebar
            propertyId={currentPropertyId}
            showTeams={!hidden.includes("teams")}
            showProjects={!hidden.includes("projects")}
          />
        </SidebarContent>

        <SidebarFooter className="p-2 pt-1">
          <UserMenu user={user} />
        </SidebarFooter>
      </div>
    </aside>
  );
}

/**
 * ClickUp-style « close button: invisible until the pointer is over the
 * sidebar (or the button has keyboard focus), so the header stays quiet. The
 * matching » "Open sidebar" button floats at the content pane's top-left
 * while collapsed (see `LeftShell`). Desktop only — the mobile drawer always
 * shows the sidebar.
 */
function SidebarCollapseButton() {
  const { setSidebarCollapsed } = useShellSection();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            aria-label="Close sidebar"
            className="ml-auto flex size-[30px] shrink-0 items-center justify-center rounded-md text-secondary-ink opacity-0 outline-hidden transition-[opacity,background-color] group-hover/section-sidebar:opacity-100 hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:shadow-focus max-md:hidden"
          >
            <CloseSidebarIcon className="size-4" />
          </button>
        }
      />
      <TooltipContent side="bottom">
        Close sidebar
        <kbd className="ml-1.5 font-sans text-xs font-normal opacity-60">
          ⌘\
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
}
