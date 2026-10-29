"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
 *   `toolbar` (default) — gr8r `btn btn-ghost btn-sm`, for dense toolbars,
 *                         the topbar and icon-row headers (board toolbar,
 *                         channel header).
 *   `outline`           — gr8r `btn btn-secondary`, a peer of "New form" /
 *                         "New service" in a page's `.ph .acts`.
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={cn(
          variant === "outline" ? "btn btn-secondary" : "btn btn-ghost btn-sm",
          className,
        )}
      >
        <Gi icon={Zap} size={14} />
        {showLabel || variant === "outline" ? "Automations" : null}
        {count > 0 ? <span className="faint num">{count}</span> : null}
      </button>
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
