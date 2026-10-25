"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  navNodeFor,
  useShellSection,
  type ShellSection,
} from "./shell-section-context";
import type { SectionTarget } from "./use-section-navigation";

/**
 * One top-level row of the sidebar tree — Linear's team row, ClickUp's Space
 * row: the label navigates to the section (resuming where you left off), the
 * chevron opens the node's children in place. Children stay MOUNTED while
 * closed (`hidden`, not unmounted) so their data, subscriptions and scroll
 * position are warm and reopening is instant — the same trick the old
 * per-section panes used.
 *
 * Counts render inline at the row's end (not `SidebarMenuBadge`, which is
 * absolutely positioned over the chevron's slot). A bare `dot` is the
 * "something needs attention, no number" signal.
 */
export function NavNode({
  item,
  label,
  icon: Icon,
  count,
  dot = false,
  active: activeOverride,
  children,
  navigate,
}: {
  item: SectionTarget;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  dot?: boolean;
  /** Override the section-derived highlight (the Workspace group lights a
   *  row from the URL's app, so routes the shell files under Home — My
   *  tasks, Projects, Initiatives — don't light Home too). */
  active?: boolean;
  /** The node's children; omit for a plain row. */
  children?: ReactNode;
  navigate: (item: SectionTarget) => void;
}) {
  const { section, expanded, toggleExpanded } = useShellSection();
  const active = activeOverride ?? navNodeFor(section) === item.section;
  const open = !!children && expanded.has(item.section);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<button type="button" />}
        onClick={() => navigate(item)}
        isActive={active}
        aria-current={active ? "page" : undefined}
        tooltip={label}
      >
        <Icon />
        <span className="flex-1">{label}</span>
        {count && count > 0 ? (
          <span
            className={cn(
              "shrink-0 text-xs font-medium tabular-nums",
              active ? "text-sidebar-accent-foreground" : "text-faint-foreground",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : dot ? (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-warning"
          />
        ) : null}
      </SidebarMenuButton>
      {children ? (
        <>
          <SidebarMenuAction
            showOnHover
            onClick={() => toggleExpanded(item.section)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          >
            <ChevronRight
              className={cn("transition-transform", open && "rotate-90")}
            />
          </SidebarMenuAction>
          {/* Children indent by 12px under the parent's icon column; the
              section bodies keep their own group rhythm but drop the group's
              horizontal inset (the parent row already set it). */}
          <div
            className={cn(
              "pl-3 [&_[data-sidebar=group]]:px-0 [&_[data-sidebar=group]]:py-1",
              !open && "hidden",
            )}
          >
            {children}
          </div>
        </>
      ) : null}
    </SidebarMenuItem>
  );
}

/** The `SectionTarget` for a section at the property's base path. */
export function target(
  base: string,
  section: ShellSection,
  path: string,
  routeKey?: string,
): SectionTarget {
  return { section, href: `${base}${path}`, routeKey };
}
