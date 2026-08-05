"use client"

import { cn } from "@/lib/utils"

/**
 * The house selectable chip — a toggleable control for filters, multi-select
 * option pickers, and question screens. Carries `aria-pressed` so the
 * selected state is real, not just visual.
 *
 * Two worlds:
 *   `app`   — shell surfaces, Notion language: 6px radius, NO border,
 *             fill-only hover (`bg-accent`), selected = the pressed warm
 *             rung. Nothing changes color on hover but the fill.
 *   `guest` — the warm-cream guest world (wizard, public booking, forms
 *             wizard): rust accent on cream, pill shape, bordered. This
 *             branch is DELIBERATELY untouched by the Notion normalization —
 *             every class it emits is byte-identical to the pre-Notion chip.
 *
 * A chip is a CLICKABLE, so it stays on the 6px rung — it is deliberately
 * NOT converted to the 4px `rounded-pill` rung that Badge/StatusBadge moved
 * to in v2. A pill states a value; a chip is a control you press.
 *
 * Two sizes, both on the UI rung of the type ramp (14px — notion-spec-v2 §2:
 * a control label is UI, never metadata, so `sm` is a shorter chip and not a
 * smaller typeface):
 *   `default` — the wizard/question-screen scale (generous tap target).
 *   `sm`      — dense toolbar filter pills.
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
        "inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0",
        // --- app: Notion control language -------------------------------
        tone === "app" && [
          "rounded-md font-medium transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus",
          size === "default" ? "h-7 px-2.5 text-sm" : "h-6 px-2 text-sm",
          selected
            ? "bg-accent-pressed text-foreground"
            : "bg-transparent text-muted-foreground hover:bg-accent",
        ],
        // --- guest: frozen, out of scope --------------------------------
        tone === "guest" && [
          "rounded-full border transition-colors duration-150",
          size === "default" ? "px-4 py-2 text-sm" : "h-6 px-2.5 text-xs",
          selected
            ? "border-guest-accent bg-guest-accent/10 text-guest-accent-ink"
            : "border-guest-line bg-guest-card text-guest-ink-mid hover:border-guest-line-strong",
        ],
        className
      )}
      {...props}
    />
  )
}

export { Chip }
