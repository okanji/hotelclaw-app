import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The house status badge — a tone-driven pill with a leading dot, for
 * domain lifecycle states (form published/closed, chatbot live/paused,
 * workflow ok/failed, conversation open/escalated…).
 *
 * Domains keep their own status→tone map (see lib/bookings/status-colors.ts
 * for the richest example) and render the badge with a `tone`; they never
 * re-pick color shades inline. Tones reuse the semantic ramp from
 * globals.css (--success/--warning/--info/--destructive) plus violet for
 * "in-progress/occupied" states.
 *
 * Notion language (notion-spec-v2 §6): this is the measured STATUS PILL —
 * 20px tall, 4px radius (`rounded-pill`, NOT the 6px clickable rung), padding
 * `0 6px`, label 14px weight 500, fill = the hue at ~16% alpha and ink = the
 * same hue darkened. No stroke, ever: the tinted fill plus the leading dot
 * already read as a state.
 *
 * Every tone is a `--pill-*` token PAIR, so the fill/ink relationship is
 * defined once in globals.css and inverts correctly on the dark plane with no
 * `dark:` override here. Violet is the entity-palette rung (in-progress /
 * occupied / seated), which is why it is `pill-violet` and not a raw
 * `violet-500` — the tailwind palette is cold and breaks on the warm planes.
 */
const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-pill-neutral text-pill-neutral-ink",
        success: "bg-pill-success text-pill-success-ink",
        warning: "bg-pill-warning text-pill-warning-ink",
        info: "bg-pill-info text-pill-info-ink",
        danger: "bg-pill-danger text-pill-danger-ink",
        violet: "bg-pill-violet text-pill-violet-ink",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

function StatusBadge({
  tone = "neutral",
  dot = true,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof statusBadgeVariants> & {
    /** Leading state dot; disable for text-only badges. */
    dot?: boolean
  }) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ tone }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  )
}

export { StatusBadge, statusBadgeVariants }
