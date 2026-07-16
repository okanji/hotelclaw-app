"use client";

import { Search } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { useCommandPalette } from "./command-palette-context";

/**
 * Visible "Search" entry in the sidebar — opens the same palette the
 * Cmd+K shortcut opens. Shows the keyboard hint on the right.
 */
export function SearchButton() {
  const { toggle } = useCommandPalette();
  const shortcut = typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? "⌘K"
    : "Ctrl+K";

  return (
    <SidebarMenuItem>
      {/* A recessed search *well* — reads as a field, not a nav row. Ring
          (not a solid border) per form-control rules; matches the property
          switcher's h-9 for a tidy header rhythm. */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Search"
        className="group flex h-9 w-full items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-sm text-muted-foreground ring-1 ring-border/70 ring-inset transition-colors outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-4 shrink-0 opacity-80 transition-opacity group-hover:opacity-100" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground shadow-2xs ring-1 ring-border/70">
          {shortcut}
        </kbd>
      </button>
    </SidebarMenuItem>
  );
}
