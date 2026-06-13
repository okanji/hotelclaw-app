"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks records created by a workflow (tasks, documents, entities — anything
 * carrying the migration-0050 provenance columns). Two appearances:
 *
 *   • "glyph"  — bare ⚡ for dense surfaces (board cards, list rows)
 *   • "chip"   — labelled pill for detail views; links to the run that
 *                created the record when both ids are present
 */
export function WorkflowProvenanceBadge({
  propertyId,
  source,
  workflowId,
  workflowRunId,
  appearance = "chip",
  className,
}: {
  /** Needed only for the chip's run link; the bare glyph never links. */
  propertyId?: string;
  source: string | null | undefined;
  workflowId?: string | null;
  workflowRunId?: string | null;
  appearance?: "glyph" | "chip";
  className?: string;
}) {
  if (source !== "workflow") return null;

  if (appearance === "glyph") {
    return (
      <span
        title="Created by a workflow"
        aria-label="Created by a workflow"
        className={cn(
          "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
          className,
        )}
      >
        <Zap className="size-3" aria-hidden />
      </span>
    );
  }

  const chip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
        workflowId && workflowRunId && "hover:bg-violet-100 dark:hover:bg-violet-950/70",
        className,
      )}
    >
      <Zap className="size-3" aria-hidden />
      Created by workflow
    </span>
  );

  if (propertyId && workflowId && workflowRunId) {
    return (
      <Link
        href={`/p/${propertyId}/workflows/${workflowId}/runs/${workflowRunId}`}
        title="Open the run that created this"
      >
        {chip}
      </Link>
    );
  }
  return chip;
}
