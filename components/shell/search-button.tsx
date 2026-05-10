"use client";

import { Search } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useCommandPalette } from "./command-palette-context";

/**
 * Visible "Search" entry in the sidebar — opens the same palette the
 * Cmd+K shortcut opens. Shows the keyboard hint on the right.
 */
export function SearchButton() {
  const { setOpen } = useCommandPalette();
  const shortcut = typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
    ? "⌘K"
    : "Ctrl+K";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={() => setOpen(true)} tooltip="Search">
        <Search />
        <span>Search</span>
        <span className="ml-auto rounded border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
