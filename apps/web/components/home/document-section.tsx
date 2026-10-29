"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, type LucideIcon } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { cn } from "@/lib/utils";
import type { WidgetTone } from "./dashboard-registry";

/**
 * A Home section as a gr8r `.panel`: a pastel icon chip, the title and a
 * faint kicker in the head, the widget in the body. Every section is a
 * dnd-kit sortable item in Home's two-column grid — `span="full"` takes
 * both columns — and the reorder grip + hide button reveal on hover / focus.
 * The per-user arrangement (`useDashboardLayout`) is unchanged.
 */
export function DocumentSection({
  id,
  title,
  subLabel,
  icon,
  tone = "gray",
  span,
  flush = false,
  onHide,
  headerRight,
  children,
}: {
  id: string;
  title: string;
  /** Sentence-case 12px faint caption beside the heading. */
  subLabel?: string;
  icon?: LucideIcon;
  tone?: WidgetTone;
  span?: "full";
  /** The body draws its own edge-to-edge rows (lists, tables). */
  flush?: boolean;
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
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        gridColumn: span === "full" ? "1 / -1" : undefined,
      }}
      className={cn(
        "panel home-section group/section relative min-w-0",
        isDragging && "is-dragging",
      )}
    >
      <div className="panel-h">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${title}`}
          title="Drag to reorder"
          className="ibtn ibtn-sm home-grip"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {icon ? (
          <span
            className="picon home-chip"
            style={
              { "--g8-c": `var(--g8-${tone})`, "--g8-sz": "24px" } as CSSProperties
            }
            aria-hidden="true"
          >
            <Gi icon={icon} size={13} />
          </span>
        ) : null}
        <h2 className="trunc">{title}</h2>
        {subLabel ? (
          <span className="faint trunc hide-m" style={{ fontSize: "var(--g8-fs-xs)" }}>
            {subLabel}
          </span>
        ) : null}
        <div className="acts">
          {headerRight}
          <button
            type="button"
            className="ibtn ibtn-sm home-hide"
            aria-label={`Hide ${title}`}
            title="Hide"
            onClick={onHide}
          >
            <EyeOff size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={flush ? "min-w-0" : "panel-b min-w-0"}>{children}</div>
    </section>
  );
}
