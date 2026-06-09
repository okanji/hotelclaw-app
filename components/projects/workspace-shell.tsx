"use client";

import { useEffect, useState } from "react";
import { ChevronDown, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const RAIL_STORAGE_KEY = "workspace:rail-collapsed";

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
  headerActions,
  tabs,
  rightRail,
  defaultTab,
}: {
  header: React.ReactNode;
  /** Page-level actions (e.g. a ⋯ overflow menu) shown top-right of the header. */
  headerActions?: React.ReactNode;
  tabs: WorkspaceTab[];
  rightRail?: React.ReactNode;
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  // Collapse state for the right properties rail, persisted across pages.
  const [railCollapsed, setRailCollapsed] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem(RAIL_STORAGE_KEY) === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRailCollapsed(true);
    }
  }, []);
  function toggleRail() {
    setRailCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-0 justify-center">
      <div className="flex w-full min-w-0 max-w-7xl">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-12 sm:pt-14">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{header}</div>
            {headerActions || rightRail ? (
              <div className="flex shrink-0 items-center gap-0.5">
                {headerActions}
                {rightRail ? (
                  <button
                    type="button"
                    onClick={toggleRail}
                    aria-label={railCollapsed ? "Expand panel" : "Collapse panel"}
                    aria-expanded={!railCollapsed}
                    title={railCollapsed ? "Expand panel" : "Collapse panel"}
                    className="hidden size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
                  >
                    {railCollapsed ? (
                      <PanelRightOpen className="size-4" />
                    ) : (
                      <PanelRightClose className="size-4" />
                    )}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

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

        {rightRail && !railCollapsed ? (
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

/**
 * A titled group in the properties rail (eyebrow label + content). Groups are
 * separated by a hairline; the first group sits flush with no top divider.
 */
export function RailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 border-t border-border/60 pt-4 first:mt-0 first:border-0 first:pt-0">
      <span className="mb-2.5 block text-[0.6875rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** Compact completion meter for the rail: big %, done/total, thin bar. */
export function RailProgress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[1.25rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">
          {pct}%
        </span>
        <span className="text-[0.75rem] text-muted-foreground tabular-nums">
          {done}/{total} done
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <div
            className="h-full bg-emerald-500 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A formatted date value for the rail, or an em-dash when missing. */
export function RailDate({ value }: { value: string | null }) {
  if (!value)
    return <span className="text-[0.8125rem] text-muted-foreground">—</span>;
  return (
    <span className="text-[0.8125rem] tracking-tight text-foreground tabular-nums">
      {new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </span>
  );
}

/**
 * Shared styling for an interactive rail value (Linear-style): borderless,
 * left-aligned icon + text, with a hover surface. Apply to menu/picker triggers
 * and links so every property value reads the same.
 */
export const railValueClass =
  "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.8125rem] tracking-tight text-foreground hover:bg-muted";

/**
 * A collapsible, titled group in the properties rail — the Linear pattern of
 * "Properties ▾ / Activity ▾" sections. `action` renders on the right of the
 * header (e.g. a "See all" link or "+" button).
 */
export function RailGroup({
  label,
  action,
  defaultOpen = true,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-border/60 py-4 first:border-0 first:pt-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group/grp -ml-1 flex flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[0.8125rem] font-medium tracking-tight text-foreground hover:bg-muted"
        >
          {label}
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? <div className="mt-2 flex flex-col gap-0.5">{children}</div> : null}
    </section>
  );
}

/**
 * A Linear-style property row: a muted fixed-width label and an interactive
 * value. Pass the value as a menu/picker trigger or link styled with
 * `railValueClass`.
 */
export function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-start gap-2">
      <span className="w-20 shrink-0 pt-1.5 text-[0.8125rem] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center py-0.5">{children}</div>
    </div>
  );
}

/** A list of label → number/value rows (scope counts) for the rail. */
export function RailStats({
  stats,
}: {
  stats: { label: string; value: number | string }[];
}) {
  return (
    <dl className="flex flex-col gap-2">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center justify-between gap-3">
          <dt className="text-[0.8125rem] tracking-tight text-muted-foreground">
            {s.label}
          </dt>
          <dd className="text-[0.8125rem] font-medium tabular-nums text-foreground">
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
