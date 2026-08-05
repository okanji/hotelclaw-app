"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

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
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-pill-violet text-pill-violet-ink",
          className,
        )}
      >
        <Zap className="size-3" aria-hidden />
      </span>
    );
  }

  const chip = (
    <StatusBadge
      tone="violet"
      dot={false}
      className={cn(
        "gap-1",
        workflowId && workflowRunId && "hover:bg-pill-violet-ink/20",
        className,
      )}
    >
      <Zap className="size-3" aria-hidden />
      Created by workflow
    </StatusBadge>
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
