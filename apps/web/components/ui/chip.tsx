"use client"

import { cn } from "@/lib/utils"

/**
 * The house selectable chip — a toggleable pill for filters, multi-select
 * option pickers, and question screens. Carries `aria-pressed` so the
 * selected state is real, not just visual.
 *
 * Two worlds:
 *   `app`   — shell surfaces: border/muted on the theme background.
 *   `guest` — the warm-cream guest world (wizard, public booking, forms
 *             wizard): rust accent on cream. This is the chip the
 *             onboarding wizard hand-rolled.
 */
function Chip({
  selected = false,
  tone = "app",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  selected?: boolean
  tone?: "app" | "guest"
}) {
  return (
    <button
      type={type}
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-4 py-2 text-sm transition-colors duration-150",
        tone === "app" &&
          (selected
            ? "border-primary/40 bg-primary/10 text-foreground"
            : "border-border bg-transparent text-muted-foreground hover:border-ring hover:text-foreground"),
        tone === "guest" &&
          (selected
            ? "border-guest-accent bg-guest-accent/10 text-guest-accent-ink"
            : "border-guest-line bg-guest-card text-guest-ink-mid hover:border-guest-line-strong"),
        className
      )}
      {...props}
    />
  )
}

export { Chip }
