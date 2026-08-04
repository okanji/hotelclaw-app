"use client";

import { useTheme } from "next-themes";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Theme switcher dropdown item — Light / Dark / System.
 *
 * Renders as a submenu so it can live inside the user-account dropdown
 * alongside Edit profile / Sign out, without crowding the top-level menu.
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const current = theme ?? "system";
  const Icon =
    current === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon className="size-4" />
        Theme
        <span className="ml-auto text-xs font-normal text-faint-foreground capitalize">
          {current}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="size-4" />
          Light
          {current === "light" ? (
            <Check className="ml-auto size-4 text-faint-foreground" />
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="size-4" />
          Dark
          {current === "dark" ? (
            <Check className="ml-auto size-4 text-faint-foreground" />
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Laptop className="size-4" />
          System
          {current === "system" ? (
            <Check className="ml-auto size-4 text-faint-foreground" />
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
