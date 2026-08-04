"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The steps behind a bot reply, collapsed.
 *
 * The thinking indicator shows the feed live, but it is transient — once the
 * reply lands there is no record of what the bot actually did. The runtime
 * stamps the turn's steps onto the delivered message as `eve_steps`
 * (channel-delivery.ts, migration 0096) and this renders them on demand.
 *
 * Progressive disclosure, deliberately: collapsed to a single muted line so a
 * 12-step turn doesn't bury the answer, expandable for anyone who wants to
 * audit the path — "summary first, detail on request".
 */
export type AiStep = { label: string; at: string };

export function isAiSteps(value: unknown): value is AiStep[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        typeof (s as AiStep).label === "string" &&
        typeof (s as AiStep).at === "string",
    )
  );
}

function elapsed(steps: AiStep[]): string | null {
  const first = new Date(steps[0].at).getTime();
  const last = new Date(steps[steps.length - 1].at).getTime();
  if (Number.isNaN(first) || Number.isNaN(last) || last <= first) return null;
  const secs = Math.round((last - first) / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function AiStepsDisclosure({ steps }: { steps: AiStep[] }) {
  const [open, setOpen] = useState(false);
  const took = elapsed(steps);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        <ChevronRight
          data-slot="icon"
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {steps.length} step{steps.length === 1 ? "" : "s"}
        {took ? ` · ${took}` : ""}
      </button>
      {open ? (
        <ol className="mt-1 space-y-0.5 border-l border-border pl-3">
          {steps.map((step, i) => (
            <li
              key={`${step.at}-${i}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Check data-slot="icon" className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
