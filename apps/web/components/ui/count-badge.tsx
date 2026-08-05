import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The house count bubble — the tiny numeric badge on rail items, tabs,
 * sidebar rows, and section headers ("15 unread", "3 pending"). A 16px
 * circle that stretches into a pill for multi-digit counts.
 *
 * Solid tones (`notification`, `warning`, `brand`, `primary`) pop as
 * overlays on icons; soft tones (`neutral`, `warning-soft`) sit inline
 * beside labels. Positioning (absolute offsets, `ring-2 ring-sidebar`
 * against the surface) stays at the call site via `className`.
 *
 * The solid tones are a set of DISTINCT SIGNALS, so there are exactly three
 * colours in it plus ink — adding a fourth hue makes none of them mean
 * anything.
 *
 * This is the ONE badge that stays ROUND — `rounded-full` is a rung of the
 * five-radius scale in its own right (avatars, dots, count bubbles), and
 * Notion's count bubbles are circles too. Everything else in the badge family
 * sits on the 4px pill rung (`Badge`, `StatusBadge`).
 *
 * It also keeps the 12px METADATA type rung while the pills moved to 14px: a
 * count is a caption on something else, not a value in its own right, and
 * 14px digits would not fit a 16px circle.
 *
 * `tone="primary"` is the INK bubble — solid warm black, white digits. It is
 * deliberately NOT `bg-primary`: `--primary` became Notion blue on
 * 2026-08-05, which silently turned this tone into a fourth solid hue
 * competing with `notification` / `warning` / `brand`, none of which it had
 * ever meant. The tone keeps its name (call sites are unchanged) and gets
 * back the warm ink it always rendered as. Blue on a count would have to mean
 * "this count is an action", and a count never is.
 */
const countBadgeVariants = cva(
  "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-xs font-medium whitespace-nowrap tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-accent text-muted-foreground",
        primary: "bg-foreground text-background",
        notification: "bg-notification text-white",
        warning: "bg-warning text-white dark:text-background",
        "warning-soft": "bg-warning/15 text-warning",
        brand: "bg-brand-accent text-brand",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

function CountBadge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof countBadgeVariants>) {
  return (
    <span
      data-slot="count-badge"
      className={cn(countBadgeVariants({ tone }), className)}
      {...props}
    />
  )
}

export { CountBadge, countBadgeVariants }
