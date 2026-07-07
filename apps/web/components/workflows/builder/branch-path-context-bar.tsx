"use client";

import { ChevronRight, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BranchPathKey } from "@/lib/workflows/branch-paths";

export type BranchPathFocus = {
  branchStepId: string;
  key: BranchPathKey;
};

/**
 * Inspector trail linking a branch lane (Then/Else) back to its decision step.
 */
export function BranchPathContextBar({
  branchTitle,
  conditionSummary,
  pathLabel,
  currentStepTitle,
  onOpenBranch,
  onOpenPath,
  className,
}: {
  branchTitle: string;
  conditionSummary?: string | null;
  pathLabel: string;
  /** When editing a step inside the lane — shown as the last crumb. */
  currentStepTitle?: string | null;
  onOpenBranch: () => void;
  onOpenPath?: () => void;
  className?: string;
}) {
  const pathTone =
    pathLabel === "Then"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";

  return (
    <nav
      aria-label="Branch path"
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-border/50 bg-muted/[0.06] px-4 py-2 text-xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpenBranch}
        className="inline-flex max-w-[min(100%,12rem)] min-w-0 items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        title={conditionSummary ?? branchTitle}
      >
        <GitBranch className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-medium">{branchTitle}</span>
      </button>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
      {onOpenPath ? (
        <button
          type="button"
          onClick={onOpenPath}
          className={cn(
            "rounded px-1 py-0.5 font-semibold transition-colors hover:bg-muted/50",
            pathTone,
          )}
        >
          {pathLabel}
        </button>
      ) : (
        <span className={cn("font-semibold", pathTone)}>{pathLabel}</span>
      )}
      {currentStepTitle ? (
        <>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
          <span className="truncate font-medium text-foreground">{currentStepTitle}</span>
        </>
      ) : null}
    </nav>
  );
}
