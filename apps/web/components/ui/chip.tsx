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
 *
 * Two sizes:
 *   `default` — the wizard/question-screen scale (generous tap target).
 *   `sm`      — dense toolbar filter pills (h-6, matches TabNav's pill).
 */
function Chip({
  selected = false,
  tone = "app",
  size = "default",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  selected?: boolean
  tone?: "app" | "guest"
  size?: "default" | "sm"
}) {
  return (
    <button
      type={type}
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border transition-colors duration-150 [&_svg]:size-3.5 [&_svg]:shrink-0",
        size === "default" ? "px-4 py-2 text-sm" : "h-6 px-2.5 text-xs",
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
