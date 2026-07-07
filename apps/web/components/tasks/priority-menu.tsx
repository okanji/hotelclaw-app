"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PRIORITY_META, PRIORITY_MENU_ORDER } from "./kanban";
import { PriorityBars } from "./task-icons";
import { updateTask } from "./actions";
import type { TaskPriority } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* PriorityChip — the small circular button shown on a task card. Renders the */
/* priority glyph (bars / dashes / urgent) inside a subtle bordered pill, and */
/* opens a Linear-style priority menu on click.                               */
/* -------------------------------------------------------------------------- */

type PriorityChipProps = {
  taskId: string;
  priority: TaskPriority;
  onChanged?: () => void;
  /** Stop the parent's drag listeners from hijacking the click. */
  stopDrag?: boolean;
  /**
   * `chip` (default) wraps the glyph in a rounded bordered pill — used when
   * the priority needs its own affordance (e.g. detail panel buttons).
   * `bare` renders just the glyph with a hit-area, matching Linear's
   * kanban-card priority indicator that sits inline with other metadata.
   */
  appearance?: "chip" | "bare";
  className?: string;
};

export function PriorityChip({
  taskId,
  priority,
  onChanged,
  stopDrag = true,
  appearance = "chip",
  className,
}: PriorityChipProps) {
  const [pending, startTransition] = useTransition();
  const meta = PRIORITY_META[priority];
  const isNone = priority === "none";
  const isBare = appearance === "bare";

  function setPriority(next: TaskPriority) {
    if (next === priority) return;
    startTransition(async () => {
      const result = await updateTask({ taskId, priority: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onChanged?.();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Priority: ${meta.label}. Change priority.`}
            onPointerDown={stopDrag ? (e) => e.stopPropagation() : undefined}
            onClick={stopDrag ? (e) => e.stopPropagation() : undefined}
            disabled={pending}
            className={cn(
              isBare
                ? "inline-flex size-5 items-center justify-center rounded-sm border-0 bg-transparent p-0 shadow-none"
                : isNone
                  ? // Ring + dashes live in the SVG — no extra chrome on the button.
                    "inline-flex size-5 items-center justify-center rounded-full border-0 bg-transparent p-0 shadow-none"
                  : "inline-flex h-5 w-6 items-center justify-center rounded-full border border-border/60 bg-transparent",
              "text-muted-foreground transition-colors",
              !isNone && !isBare &&
                "hover:border-border hover:bg-foreground/5 hover:text-foreground",
              isBare && "hover:bg-foreground/8 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !isNone && !isBare && "aria-expanded:border-border aria-expanded:bg-foreground/5",
              !isNone && !isBare && "data-popup-open:border-border data-popup-open:bg-foreground/5",
              isBare && "aria-expanded:bg-foreground/8 data-popup-open:bg-foreground/8",
              isNone && !isBare && "hover:text-foreground/90",
              "disabled:opacity-50",
              className,
            )}
          />
        }
      >
        <PriorityBars
          priority={priority}
          noneVariant={isNone ? "chip" : "inline"}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-1">
        <PriorityMenuHeader />
        {PRIORITY_MENU_ORDER.map((p) => {
          const item = PRIORITY_META[p];
          const selected = p === priority;
          return (
            <DropdownMenuItem
              key={p}
              onClick={() => setPriority(p)}
              className="cursor-pointer gap-2 py-1.5"
            >
              <span className="flex w-4 items-center justify-center">
                <PriorityBars priority={p} />
              </span>
              <span
                className={cn(
                  "flex-1 text-sm",
                  selected ? "text-foreground" : "text-foreground/90",
                )}
              >
                {item.label}
              </span>
              {selected ? (
                <Check className="size-3.5 text-muted-foreground" />
              ) : null}
              <ShortcutBadge value={item.shortcut} variant="plain" />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* -------------------------------------------------------------------------- */
/* Menu header — "Set priority to..."  with a faux "P" keyboard hint on the   */
/* right. Mirrors the Linear menu chrome.                                     */
/* -------------------------------------------------------------------------- */

function PriorityMenuHeader() {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
      <span>Set priority to&hellip;</span>
      <ShortcutBadge value="P" variant="key" />
    </div>
  );
}

function ShortcutBadge({
  value,
  variant,
}: {
  value: string | number;
  variant: "plain" | "key";
}) {
  if (variant === "key") {
    return (
      <kbd
        aria-hidden
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted/60 px-1 font-sans text-xs font-medium text-muted-foreground"
      >
        {value}
      </kbd>
    );
  }
  return (
    <span
      aria-hidden
      className="ml-1 inline-flex w-3 justify-center text-xs tabular-nums text-muted-foreground"
    >
      {value}
    </span>
  );
}
