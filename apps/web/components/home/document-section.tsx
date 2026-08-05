"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A **document section** on Home — the Notion page shape, not a dashboard card.
 *
 * Home is a 720px document column (notion-spec-v2 §3), so a section is just a
 * `24px / 31.2px` weight-600 H2, an optional `12px` faint sub-label under it,
 * then the content — separated from its neighbours by whitespace alone. No
 * border, no fill, no elevation: a section is a run of prose, and only things
 * that represent a *page* (the quick-access cards) carry `shadow-card`.
 *
 * The reorder grip is the **block gutter affordance**: a `20×20`, `4px`-radius
 * `⋮⋮` in faint ink, sitting ~28px to the LEFT of the column and revealed only
 * on row hover / keyboard focus (notion-spec-v2 §3). It is positioned inside
 * the page's own horizontal padding, so it never widens the scroll box.
 *
 * `EditorialSection` (editorial-section.tsx) is the two-column *grid* variant
 * and is still what Insights renders — this is deliberately a separate
 * component rather than a variant flag, so restructuring Home cannot move a
 * pixel on Insights.
 */
export function DocumentSection({
  id,
  title,
  subLabel,
  onHide,
  headerRight,
  children,
}: {
  id: string;
  title: string;
  /** Sentence-case 12px faint caption under the heading. */
  subLabel?: string;
  onHide: () => void;
  headerRight?: React.ReactNode;
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
        "group/section relative min-w-0",
        isDragging && "opacity-60",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${title}`}
        title="Drag to reorder"
        className="absolute top-1.5 -left-7 flex size-5 cursor-grab touch-none items-center justify-center rounded-pill text-faint-foreground opacity-0 transition-opacity group-hover/section:opacity-100 hover:bg-accent hover:text-muted-foreground focus-visible:opacity-100 focus-visible:shadow-focus active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <SectionHeading title={title} subLabel={subLabel}>
        {headerRight}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Hide ${title}`}
          title="Hide"
          onClick={onHide}
          className="text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
        >
          <EyeOff className="size-3.5" />
        </Button>
      </SectionHeading>
      {children}
    </section>
  );
}

/**
 * The heading block a document section opens with — shared with the promoted
 * "today" section, which is not draggable and so is not a `DocumentSection`.
 * Children are right-aligned controls.
 */
export function SectionHeading({
  title,
  subLabel,
  children,
}: {
  title: string;
  subLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-2xl leading-[1.3] font-semibold text-foreground">
          {title}
        </h2>
        {subLabel ? (
          <p className="mt-1.5 text-xs leading-3 font-medium text-faint-foreground">
            {subLabel}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
