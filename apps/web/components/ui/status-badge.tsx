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
 */
const statusBadgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-4xl border py-0.5 pr-2 pl-1.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted/50 text-muted-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        info: "border-info/30 bg-info/10 text-info",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
        violet:
          "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
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
      className={cn(statusBadgeVariants({ tone }), !dot && "pl-2", className)}
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
