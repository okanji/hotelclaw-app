"use client";

import { Database } from "lucide-react";
import { groupRefs, type RefCandidate } from "@/lib/workflows/refs";

/**
 * Compact list of data this step can pull from — shown at the top of the
 * inspector so users understand what "Insert data" means before configuring.
 */
export function DataContextPanel({
  refs,
  variant,
}: {
  refs: RefCandidate[];
  variant: "trigger" | "step";
}) {
  const grouped = groupRefs(refs);
  if (grouped.length === 0) return null;

  const title =
    variant === "trigger"
      ? "This event includes"
      : "You can use data from";

  const top = grouped[0];
  if (!top) return null;

  return (
    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
      <Database className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
      <span className="font-medium text-foreground/80">{title}:</span>{" "}
      {top.items.slice(0, 8).map((item, i) => (
        <span key={item.path}>
          {i > 0 && ", "}
          <span className="text-foreground/85">{item.label}</span>
        </span>
      ))}
      {top.items.length > 8 && `, +${top.items.length - 8} more`}
      {variant === "step" && (
        <>
          {" "}
          — use <span className="font-medium text-foreground/80">Insert data</span> on fields
          below.
        </>
      )}
    </p>
  );
}
