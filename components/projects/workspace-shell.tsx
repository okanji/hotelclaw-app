"use client";

import { useEffect, useState } from "react";
import { ChevronDown, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const RAIL_STORAGE_KEY = "workspace:rail-collapsed";

/** Linear-scale type for workspace chrome (13px body, 28px title). */
export const ws = {
  text: "text-[0.8125rem] tracking-tight",
  title:
    "text-[1.75rem] font-semibold tracking-tight text-foreground leading-none",
  section: "text-[0.8125rem] font-medium tracking-tight text-muted-foreground",
  muted: "text-[0.8125rem] tracking-tight text-muted-foreground",
  railLabel: "text-[0.8125rem] tracking-tight text-muted-foreground",
  railValue: "text-[0.8125rem] tracking-tight text-foreground",
} as const;

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
  breadcrumb,
  header,
  headerActions,
  tabs,
  rightRail,
  defaultTab,
  activeTab,
  onActiveTabChange,
}: {
  /** Optional breadcrumb trail — shown above the view switcher (Linear-style). */
  breadcrumb?: React.ReactNode;
  header: React.ReactNode;
  /** Page-level actions (e.g. a ⋯ overflow menu) shown top-right of the header. */
  headerActions?: React.ReactNode;
  tabs: WorkspaceTab[];
  rightRail?: React.ReactNode;
  defaultTab?: string;
  /** Controlled active tab — pair with `onActiveTabChange`. */
  activeTab?: string;
  onActiveTabChange?: (id: string) => void;
}) {
  const [internalActive, setInternalActive] = useState(defaultTab ?? tabs[0]?.id);
  const active = activeTab ?? internalActive;
  const setActive = onActiveTabChange ?? setInternalActive;
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
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-8 pb-16 sm:px-10 sm:pt-10">
          {breadcrumb ? (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">{breadcrumb}</div>
              {headerActions || rightRail ? (
                <WorkspaceHeaderActions
                  headerActions={headerActions}
                  rightRail={rightRail}
                  railCollapsed={railCollapsed}
                  onToggleRail={toggleRail}
                />
              ) : null}
            </div>
          ) : null}

          <nav
            aria-label="Workspace views"
            className="mb-12 flex flex-wrap items-center gap-0.5"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-[0.8125rem] font-medium tracking-tight transition-colors",
                  t.id === current?.id
                    ? "bg-muted/80 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {t.label}
                {typeof t.count === "number" && t.count > 0 ? (
                  <span
                    className={cn(
                      "rounded px-1 text-[0.6875rem] tabular-nums",
                      t.id === current?.id
                        ? "text-muted-foreground"
                        : "text-muted-foreground/80",
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="mb-8 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{header}</div>
            {!breadcrumb && (headerActions || rightRail) ? (
              <WorkspaceHeaderActions
                headerActions={headerActions}
                rightRail={rightRail}
                railCollapsed={railCollapsed}
                onToggleRail={toggleRail}
              />
            ) : null}
          </div>

          <div className="min-h-0 flex-1">{current?.content}</div>
        </div>

        {rightRail && !railCollapsed ? (
          <aside className="hidden w-70 shrink-0 flex-col overflow-y-auto border-l border-border/40 px-5 py-10 md:flex">
            {rightRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceHeaderActions({
  headerActions,
  rightRail,
  railCollapsed,
  onToggleRail,
}: {
  headerActions?: React.ReactNode;
  rightRail?: React.ReactNode;
  railCollapsed: boolean;
  onToggleRail: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {headerActions}
      {rightRail ? (
        <button
          type="button"
          onClick={onToggleRail}
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
    <div className="flex flex-col gap-1.5 px-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-medium tabular-nums text-foreground">
          {pct}%
        </span>
        <span className="text-[0.75rem] text-muted-foreground tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="flex h-1 overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <div
            className="h-full bg-emerald-500/90 transition-[width]"
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
  "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[0.8125rem] tracking-tight text-foreground hover:bg-muted/80";

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
    <section className="border-t border-border/40 py-3.5 first:border-0 first:pt-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group/grp -ml-1 flex flex-1 items-center gap-0.5 rounded px-1 py-0.5 text-left text-[0.8125rem] font-medium tracking-tight text-foreground hover:bg-muted/80"
        >
          {label}
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground/50 transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {open ? <div className="mt-1.5 flex flex-col gap-px">{children}</div> : null}
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
    <div className="flex min-h-7 items-start gap-2">
      <span className="w-21 shrink-0 pt-1 text-[0.8125rem] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

/** Stacked icon slot above the workspace title (Linear project header). */
export function WorkspaceIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex size-10 shrink-0 items-center justify-center text-[1.625rem] leading-none">
      {children}
    </div>
  );
}

/** Overview section with a muted Linear-style label. */
export function OverviewSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className={ws.section}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Horizontal metadata row under the title — Linear's inline Properties /
 * Status / Priority chips.
 */
export function MetadataRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
  );
}

export function MetadataItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] tracking-tight">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 text-foreground">{children}</div>
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
