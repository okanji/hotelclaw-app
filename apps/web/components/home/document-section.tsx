"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A Home section as a gr8r `.panel` (gr8r-studio's panel-h / panel-b): the
 * title + a faint caption in the head, the widget in the body. The reorder
 * grip and the hide button sit in the head and reveal on hover / focus; the
 * per-user arrangement (`useDashboardLayout`) is unchanged.
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
        "panel group/section relative min-w-0",
        isDragging && "opacity-60",
      )}
    >
      <div className="panel-h">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${title}`}
          title="Drag to reorder"
          className="ibtn ibtn-sm opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
          style={{ cursor: "grab", touchAction: "none", marginLeft: -6 }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <h2 className="trunc">{title}</h2>
        {subLabel ? (
          <span className="faint trunc" style={{ fontSize: "var(--g8-fs-xs)" }}>
            {subLabel}
          </span>
        ) : null}
        <div className="acts">
          {headerRight}
          <button
            type="button"
            className="ibtn ibtn-sm opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100"
            aria-label={`Hide ${title}`}
            title="Hide"
            onClick={onHide}
          >
            <EyeOff size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="panel-b min-w-0">{children}</div>
    </section>
  );
}

/**
 * A gr8r panel head for a non-draggable panel (the promoted "today" panel).
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
    <div className="panel-h">
      <h2 className="trunc">{title}</h2>
      {subLabel ? (
        <span className="faint trunc" style={{ fontSize: "var(--g8-fs-xs)" }}>
          {subLabel}
        </span>
      ) : null}
      {children ? <div className="acts">{children}</div> : null}
    </div>
  );
}
