"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workflowsListQueryOptions } from "@/lib/query/workflow-queries";
import {
  featureMeta,
  workflowTouchesFeature,
  type AutomationFeature,
} from "@/lib/workflows/features";
import { cn } from "@/lib/utils";
import { AutomationsDialog } from "./automations-dialog";

/**
 * The lightning button — the app-wide entry point into automations from
 * wherever you already are. Drop it in any feature's header/toolbar:
 *
 *   <AutomationsButton propertyId={propertyId} feature="docs" />
 *
 * Two shapes, matching the two kinds of header it lands in:
 *   `toolbar` (default) — compact ghost button, for dense h-9 toolbars and
 *                         icon-row headers (board toolbar, channel header).
 *   `outline`           — a peer of "New form" / "New service" on the roomy
 *                         SectionHeader mastheads.
 *
 * The count badge is the whole reason this is a button and not a menu item:
 * it answers "is anything already automated here?" before you click. It reads
 * from the shared workflows list query, so it's free on any page that already
 * has it cached and one cheap request otherwise. The modal — and the model
 * call behind its suggestions — stays unmounted until the button is clicked.
 */
export function AutomationsButton({
  propertyId,
  feature,
  variant = "toolbar",
  className,
  showLabel = true,
}: {
  propertyId: string;
  feature: AutomationFeature;
  variant?: "toolbar" | "outline";
  className?: string;
  /** Icon-only when false — for headers that are already a row of glyphs. */
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: workflows = [] } = useQuery({
    ...workflowsListQueryOptions(propertyId),
    staleTime: 60_000,
  });
  const count = workflows.filter(
    (w) => w.enabled && workflowTouchesFeature(w, feature),
  ).length;
  const label = `Automations for ${featureMeta(feature).label}${
    count > 0 ? ` (${count} running)` : ""
  }`;

  return (
    <>
      {variant === "outline" ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          title={label}
          aria-label={label}
          className={className}
        >
          <Zap data-slot="icon" />
          Automations
          {count > 0 ? (
            <span className="ml-0.5 tabular-nums text-muted-foreground">{count}</span>
          ) : null}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          title={label}
          aria-label={label}
          className={cn("h-7 gap-1 px-2 text-xs", className)}
        >
          <Zap className="size-3.5 shrink-0" aria-hidden />
          {showLabel ? "Automations" : null}
          {count > 0 ? (
            <span className="tabular-nums text-muted-foreground">{count}</span>
          ) : null}
        </Button>
      )}
      {/* Mounted only once opened — keeps the suggestion request off page load,
          and unmounting on close means reopening re-reads the (cached) list. */}
      {open ? (
        <AutomationsDialog
          propertyId={propertyId}
          feature={feature}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
