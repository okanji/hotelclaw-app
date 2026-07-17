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
 */
const countBadgeVariants = cva(
  "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-xs font-medium whitespace-nowrap tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-primary text-primary-foreground",
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
