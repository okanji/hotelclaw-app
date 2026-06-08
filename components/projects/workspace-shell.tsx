"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
};

/**
 * Shared chrome for a Space / Project workspace, Linear-style: a main column
 * (header + tabs + active tab) and an optional right **properties rail**. The
 * whole [main | rail] block is bounded and centered on large screens — wider
 * than a single column, but never full-bleed.
 */
export function WorkspaceShell({
  header,
  tabs,
  rightRail,
  defaultTab,
}: {
  header: React.ReactNode;
  tabs: WorkspaceTab[];
  rightRail?: React.ReactNode;
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0 justify-center">
      <div className="flex w-full min-w-0 max-w-7xl">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-12 sm:pt-14">
          {header}

          <div className="mt-8 mb-10 flex items-center gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[0.8125rem] font-medium tracking-tight transition-colors",
                  t.id === current?.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {typeof t.count === "number" && t.count > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-muted-foreground">
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">{current?.content}</div>
        </div>

        {rightRail ? (
          <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-border/60 px-6 py-14 md:flex">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A label/value row for the properties rail. */
export function RailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-20 shrink-0 pt-1 text-[0.75rem] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
