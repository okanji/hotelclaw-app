import { cn } from "@/lib/utils";
import { PRIORITY_META } from "./kanban";
import { LABEL_INK } from "@/components/labels/label-tokens";
import type {
  EntityColor,
  StatusCategory,
  TaskPriority,
  TaskStatus,
} from "@/lib/db/types";
import type { StatusLike } from "@/lib/tasks/statuses";

/* -------------------------------------------------------------------------- */
/* Status icon — pixel-tuned Linear-style progress glyph. Custom SVG (rather  */
/* than Lucide) because Linear's icon set isn't in lucide-react: outlined     */
/* circle (not started), dashed ring (unstarted / backlog), outlined ring +   */
/* half-pie (active), outlined ring + center bar (blocked), filled disc +     */
/* white check (done / closed).                                               */
/*                                                                            */
/* Two signatures (0114): the legacy `status` literal, or the pipeline row's  */
/* `category` + `blocked` + `color` (tinted with the entity ink, the same     */
/* rung labels and projects spend). `task` takes any status-shaped row and    */
/* picks whichever it carries. Legacy tints stay what they were.              */
/* -------------------------------------------------------------------------- */

type Glyph = "circle" | "dashed" | "half" | "bar" | "check";

function glyphFor(category: StatusCategory, blocked: boolean): Glyph {
  switch (category) {
    case "open":
      return "circle";
    case "unstarted":
      return "dashed";
    case "active":
      return blocked ? "bar" : "half";
    default:
      return "check";
  }
}

function legacyCategory(status: TaskStatus | string): {
  category: StatusCategory;
  blocked: boolean;
} {
  switch (status) {
    case "in_progress":
      return { category: "active", blocked: false };
    case "blocked":
      return { category: "active", blocked: true };
    case "done":
      return { category: "closed", blocked: false };
    default:
      return { category: "open", blocked: false };
  }
}

const LEGACY_TINT: Record<Glyph, string> = {
  circle: "text-muted-foreground",
  dashed: "text-muted-foreground",
  half: "text-warning",
  bar: "text-warning",
  check: "text-success",
};

export function StatusIcon({
  status,
  category,
  blocked,
  color,
  task,
  className,
}: {
  /** Legacy literal — still accepted everywhere a row predates the catalog. */
  status?: TaskStatus | string;
  category?: StatusCategory;
  blocked?: boolean;
  /** Entity colour of the status row; omitted → the legacy semantic tints. */
  color?: EntityColor | null;
  /** Any status-shaped row (a `Task`, a `StatusRow` flattened onto it). */
  task?: StatusLike & { status_color?: EntityColor | null };
  className?: string;
}) {
  let cat: StatusCategory;
  let isBlocked: boolean;
  let tint: EntityColor | null | undefined = color;
  if (task) {
    const fromLegacy = legacyCategory(task.status ?? "todo");
    cat = task.status_category ?? fromLegacy.category;
    isBlocked =
      typeof task.status_blocked === "boolean"
        ? task.status_blocked
        : fromLegacy.blocked;
    tint = tint ?? task.status_color;
  } else if (category) {
    cat = category;
    isBlocked = blocked ?? false;
  } else {
    const fromLegacy = legacyCategory(status ?? "todo");
    cat = fromLegacy.category;
    isBlocked = fromLegacy.blocked;
  }
  const glyph = glyphFor(cat, isBlocked);
  const base = cn("size-4 shrink-0", tint ? LABEL_INK[tint] : LEGACY_TINT[glyph]);

  if (glyph === "circle" || glyph === "dashed") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className={cn(base, className)}>
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={glyph === "dashed" ? "2.6 2.2" : undefined}
        />
      </svg>
    );
  }
  if (glyph === "half") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className={cn(base, className)}>
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
  if (glyph === "bar") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className={cn(base, className)}>
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
    <svg aria-hidden viewBox="0 0 16 16" className={cn(base, className)}>
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
        className={cn("size-5 shrink-0 text-muted-foreground", className)}
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
          // The "!" is drawn as a PICTOGRAM inside a 12px plate, sitting
          // alongside the bar glyphs below — it is an icon path, not type, so
          // the 12px text floor doesn't apply. `leading-none` keeps it centred.
          "inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-md bg-destructive text-[8px] leading-none font-semibold text-white",
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
