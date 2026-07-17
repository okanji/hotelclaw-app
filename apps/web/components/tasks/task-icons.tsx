import { cn } from "@/lib/utils";
import { PRIORITY_META } from "./kanban";
import type { TaskPriority, TaskStatus } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* Status icon — pixel-tuned Linear-style progress glyph. Custom SVG (rather  */
/* than Lucide) because Linear's icon set isn't in lucide-react: outlined     */
/* circle (Todo), outlined ring + amber half-pie (In Progress), outlined ring */
/* + center bar (Blocked), filled disc + white check (Done).                  */
/* -------------------------------------------------------------------------- */

export function StatusIcon({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const base = "size-4 shrink-0";
  if (status === "todo") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn(base, "text-muted-foreground/70", className)}
      >
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn(base, "text-warning", className)}
      >
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* ~55% pie-chart fill starting from 12 o'clock, going clockwise */}
        <path
          d="M 8 8 L 8 2.5 A 5.5 5.5 0 1 1 5.41 13.43 Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (status === "blocked") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn(base, "text-warning", className)}
      >
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect
          x="4.25"
          y="7.25"
          width="7.5"
          height="1.5"
          rx="0.4"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={cn(base, "text-success", className)}
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M 4.7 8.2 L 7 10.4 L 11.3 5.9"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Priority glyph — Linear-style indicator:                                   */
/*   - none    → three short dashes ("---")                                   */
/*   - urgent  → exclamation icon in a tinted square                          */
/*   - low/med/high → ascending audio-meter bars with `rank` filled           */
/* -------------------------------------------------------------------------- */

const BAR_HEIGHTS = ["h-[5px]", "h-[8px]", "h-[11px]"] as const;

/**
 * Linear's empty-priority affordance — a thin ring with three centered dashes.
 * `chip` is the on-card trigger; `inline` is the menu-row glyph (dashes only).
 */
export function NoPriorityGlyph({
  variant = "inline",
  className,
}: {
  variant?: "chip" | "inline";
  className?: string;
}) {
  if (variant === "chip") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn("size-5 shrink-0 text-muted-foreground/70", className)}
      >
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <line
          x1="4.75"
          y1="8"
          x2="6.1"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <line
          x1="7.45"
          y1="8"
          x2="8.55"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <line
          x1="9.9"
          y1="8"
          x2="11.25"
          y2="8"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <span
      role="img"
      aria-label="No priority"
      className={cn(
        "inline-flex h-3 shrink-0 items-center gap-[2px]",
        className,
      )}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[2px] w-[3.5px] rounded-full bg-muted-foreground/80"
        />
      ))}
    </span>
  );
}

export function PriorityBars({
  priority,
  className,
  /** When `chip`, no-priority renders the full ring+dashes SVG for the card. */
  noneVariant = "inline",
}: {
  priority: TaskPriority;
  className?: string;
  noneVariant?: "chip" | "inline";
}) {
  const meta = PRIORITY_META[priority];

  if (priority === "none") {
    return <NoPriorityGlyph variant={noneVariant} className={className} />;
  }

  if (priority === "urgent") {
    return (
      <span
        role="img"
        aria-label="Urgent priority"
        title="Urgent priority"
        className={cn(
          "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm bg-destructive text-[8px] font-semibold text-white",
          className,
        )}
      >
        !
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={`${meta.label} priority`}
      title={`${meta.label} priority`}
      className={cn(
        "inline-flex h-3 shrink-0 items-end gap-[2px]",
        className,
      )}
    >
      {BAR_HEIGHTS.map((h, i) => {
        const filled = i < meta.rank;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-[1px]",
              h,
              filled ? meta.barColorClass : "bg-foreground/20",
            )}
          />
        );
      })}
    </span>
  );
}
