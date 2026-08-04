"use client";

import { Search } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { useCommandPalette } from "./command-palette-context";

/**
 * Visible "Search" entry in the sidebar — opens the same palette the
 * Cmd+K shortcut opens.
 *
 * It is a NAV ROW, not a form field: 30px tall, 6px radius, transparent at
 * rest, warm hover fill, 14px/500 secondary ink with a faint icon and a 12px
 * faint shortcut hint (docs/notion-spec.md §3/§4). The old recessed "well"
 * — a lighter `bg-background` box with an inset ring and a shadowed Kbd —
 * was the stock-library read this normalization removes.
 */
export function SearchButton() {
  const { toggle } = useCommandPalette();
  const shortcut = typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? "⌘K"
    : "Ctrl+K";

  return (
    <SidebarMenuItem>
      <button
        type="button"
        onClick={toggle}
        aria-label="Search"
        className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-secondary-ink transition-[background-color] outline-none hover:bg-sidebar-accent focus-visible:shadow-focus"
      >
        <Search className="size-4 shrink-0 text-faint-foreground" />
        <span className="flex-1 truncate">Search</span>
        <span className="shrink-0 text-xs font-normal text-faint-foreground">
          {shortcut}
        </span>
      </button>
    </SidebarMenuItem>
  );
}
