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
 * Shared chrome for a Space / Project workspace: a sticky header (caller-
 * provided — name, color, status, archive) + a tab strip, then the active tab's
 * content. Tabs are local state (the workspace is a single client surface under
 * the Home rail). Mirrors the editorial language of the rest of the app.
 */
export function WorkspaceShell({
  header,
  tabs,
  defaultTab,
}: {
  header: React.ReactNode;
  tabs: WorkspaceTab[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-14">
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
  );
}
