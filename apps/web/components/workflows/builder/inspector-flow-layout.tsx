"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FlowStep = {
  id: string;
  marker: number | "+";
  title: string;
  children: ReactNode;
};

function FlowLine({ className }: { className?: string }) {
  return <div className={cn("w-px flex-1 min-h-[20px] bg-border", className)} aria-hidden />;
}

export function FlowNode({
  step,
  title,
  children,
  isLast,
}: {
  step: number | "+";
  title: string;
  children: ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex w-7 shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground",
          )}
        >
          {step}
        </span>
        {!isLast && <FlowLine />}
      </div>
      <div className={cn("min-w-0 flex-1", !isLast && "pb-6")}>
        <p className="mb-2 text-xs font-medium text-faint-foreground">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

/** Numbered vertical timeline used by trigger + step inspectors. */
export function InspectorFlowRail({ steps }: { steps: FlowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="pt-4">
      {steps.map((s, i) => (
        <FlowNode key={s.id} step={s.marker} title={s.title} isLast={i === steps.length - 1}>
          {s.children}
        </FlowNode>
      ))}
    </div>
  );
}

/** Collapsed-by-default footer — identifier, field paths, raw JSON. Not a numbered rail step. */
export function InspectorAdvancedCollapse({ children }: { children: ReactNode }) {
  return (
    <details className="mt-6 rounded-lg bg-muted/[0.03]">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        Advanced
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">{children}</div>
    </details>
  );
}
