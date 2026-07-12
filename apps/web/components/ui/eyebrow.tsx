import { cn } from "@/lib/utils"

/**
 * The house eyebrow — the small uppercase tracked label that sits above
 * headings, date groups, and question screens. One component, two worlds:
 *
 *   `app`   — shell surfaces (activity feed date headers, calendar rails,
 *             info panels): muted-foreground on the theme background.
 *   `guest` — the warm-cream guest world (wizard, welcome, public booking):
 *             warm gray ink on cream.
 *
 * Before this existed the pattern was hand-rolled in 10+ files with
 * tracking drifting between 0.14em and 0.2em.
 */
function Eyebrow({
  tone = "app",
  className,
  ...props
}: React.ComponentProps<"p"> & { tone?: "app" | "guest" }) {
  return (
    <p
      data-slot="eyebrow"
      className={cn(
        "text-xs font-medium tracking-[0.18em] uppercase",
        tone === "app" ? "text-muted-foreground" : "text-guest-ink-faint",
        className
      )}
      {...props}
    />
  )
}

export { Eyebrow }
