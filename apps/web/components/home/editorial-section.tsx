"use client";

import { Fragment } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Separator } from "@/components/ui/separator";
import {
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onHide,
  headerRight,
  wide = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  onHide: () => void;
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
      <div className="mb-6 flex items-end justify-between gap-3 border-b border-border pb-3">
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
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {kicker}
            </span>
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerRight}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Hide ${title}`}
            title="Hide"
            onClick={onHide}
            className="text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100"
          >
            <EyeOff className="size-3.5" />
          </Button>
        </div>
      </div>
      {children}
    </section>
  );
}

/* ── Arrangement controls (shared by Home + Insights) ─────────────────────── */

/** Header dropdown for a rearrangeable page: per-section show/hide toggles
 *  and a reset to the shipped default. */
export function CustomizeMenu({
  items,
  visibleCount,
  isHidden,
  onToggle,
  onReset,
}: {
  items: { id: string; title: string }[];
  visibleCount: number;
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" size="sm" variant="ghost">
            <SlidersHorizontal className="size-4" />
            Customize
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs tracking-wide text-muted-foreground uppercase">
            Sections
          </DropdownMenuLabel>
          {items.map((w) => (
            <DropdownMenuCheckboxItem
              key={w.id}
              checked={!isHidden(w.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(w.id)}
              disabled={!isHidden(w.id) && visibleCount === 1}
            >
              {w.title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset layout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Placeholder tray for hidden sections — each a chip that brings the section
 *  back. So hiding tucks a section away here rather than vanishing it. */
export function HiddenTray({
  items,
  hidden,
  onRestore,
}: {
  items: { id: string; title: string }[];
  hidden: string[];
  onRestore: (id: string) => void;
}) {
  if (hidden.length === 0) return null;
  return (
    <div className="mt-14 border-t border-border/60 pt-6">
      <p className="mb-3 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Hidden
      </p>
      <div className="flex flex-wrap gap-2">
        {hidden.map((id) => {
          const def = items.find((w) => w.id === id);
          if (!def) return null;
          return (
            <Button
              key={id}
              type="button"
              variant="outline"
              onClick={() => onRestore(id)}
              title={`Show ${def.title}`}
              className="gap-2 rounded-full border-dashed border-border/70 bg-muted/30 px-3 font-normal tracking-tight text-muted-foreground hover:border-foreground/25"
            >
              <Eye className="size-3.5" />
              {def.title}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Shared widget primitives ─────────────────────────────────────────────── */

export type StatItem = {
  label: string;
  value: number | string;
  tone?: "rose" | "emerald";
};

/** Inline stat one-liner for WIDGET INTERNALS — value + label pairs with
 *  hairline separators. Three stat tiers now exist; pick by altitude:
 *  `ui/stat-card` = page-headline row (Claude-dashboard cards),
 *  `ui/stat` (StatGroup) = section-level stacked columns,
 *  this = the compact in-widget one-liner. */
export function Stats({ items }: { items: StatItem[] }) {
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm tracking-tight text-muted-foreground">
      {items.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 ? (
            <Separator orientation="vertical" className="h-3.5" />
          ) : null}
          <div className="flex items-baseline gap-1.5">
            <dd
              className={cn(
                "text-base font-semibold tracking-tight tabular-nums text-foreground",
                s.tone === "rose" && Number(s.value) > 0 && "text-destructive",
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
    <p className="py-4 text-sm text-pretty text-muted-foreground">
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
