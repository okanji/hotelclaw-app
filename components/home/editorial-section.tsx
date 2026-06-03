"use client";

import { Fragment } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, GripVertical } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * A Home dashboard section in the editorial language of the Docs "Directory":
 * an uppercase kicker + heading over a hairline rule, then content laid out
 * with whitespace and dividers — not cards. The whole section is a dnd-kit
 * sortable item; the drag grip and hide control sit in the heading and reveal
 * on hover, so the layout stays calm at rest but is fully rearrangeable.
 */
export function EditorialSection({
  id,
  kicker,
  title,
  collapsed = false,
  onToggleCollapse,
  headerRight,
  wide = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  collapsed?: boolean;
  onToggleCollapse: () => void;
  headerRight?: React.ReactNode;
  /** Span both columns on wide containers (boards, full-width lists). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/section min-w-0",
        wide && "@4xl:col-span-2",
        isDragging && "opacity-60",
      )}
    >
      <div
        className={cn(
          "flex items-end justify-between gap-3 border-b border-border pb-3",
          collapsed ? "mb-0" : "mb-6",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${title}`}
            className="-ml-6 cursor-grab touch-none text-muted-foreground/30 opacity-0 transition-opacity group-hover/section:opacity-100 hover:text-muted-foreground/70 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[0.625rem] font-medium tracking-[0.2em] text-muted-foreground uppercase">
              {kicker}
            </span>
            <h2 className="truncate text-[1.375rem] font-semibold tracking-tight text-foreground">
              {title}
            </h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerRight}
          <button
            type="button"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            title={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                collapsed && "-rotate-90",
              )}
            />
          </button>
        </div>
      </div>
      {collapsed ? null : children}
    </section>
  );
}

/* ── Shared widget primitives ─────────────────────────────────────────────── */

export type StatItem = {
  label: string;
  value: number | string;
  tone?: "rose" | "emerald";
};

/** Inline stat row — value + label, hairline separators between. Mirrors the
 *  Docs home header `dl`; the editorial alternative to boxed metric cards. */
export function Stats({ items }: { items: StatItem[] }) {
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-[0.8125rem] tracking-tight text-muted-foreground">
      {items.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 ? (
            <Separator orientation="vertical" className="h-3.5" />
          ) : null}
          <div className="flex items-baseline gap-1.5">
            <dd
              className={cn(
                "text-[1.0625rem] font-semibold tracking-tight tabular-nums text-foreground",
                s.tone === "rose" &&
                  Number(s.value) > 0 &&
                  "text-rose-500",
              )}
            >
              {s.value}
            </dd>
            <dt className="text-muted-foreground/80">{s.label}</dt>
          </div>
        </Fragment>
      ))}
    </dl>
  );
}

/** A hairline-divided list — the editorial row container used across widgets. */
export function DividerList({ children }: { children: React.ReactNode }) {
  return (
    <ul
      role="list"
      className="flex flex-col divide-y divide-border/40 border-t border-border/40"
    >
      {children}
    </ul>
  );
}

/** Shared row padding/feel for divider-list rows. */
export const ROW_CLASS = "flex items-center gap-3 px-1 py-2.5";

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-4 text-[0.8125rem] text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

/** Compact relative time ("now", "3m", "2h", "5d", or short date past 7d). */
export function relativeShort(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
