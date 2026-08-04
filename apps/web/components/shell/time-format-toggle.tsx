"use client";

import { Check, Clock } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useTimeFormat } from "@/lib/preferences/time-format-context";

/**
 * Clock format switcher inside the user-account dropdown — toggles between
 * 12-hour (am/pm) and 24-hour times across the app. Saved to the user's
 * profile so the preference travels with them across devices.
 */
export function TimeFormatToggle() {
  const { format, setFormat } = useTimeFormat();
  const label = format === "12h" ? "12-hour" : "24-hour";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Clock className="size-4" />
        Time format
        <span className="ml-auto text-xs font-normal text-faint-foreground">
          {label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => void setFormat("12h")}>
          12-hour
{format === "12h" ? <Check className="ml-auto size-4 text-faint-foreground" /> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void setFormat("24h")}>
          24-hour
{format === "24h" ? <Check className="ml-auto size-4 text-faint-foreground" /> : null}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
