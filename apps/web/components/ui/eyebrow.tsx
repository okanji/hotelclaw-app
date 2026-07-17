import { cn } from "@/lib/utils"

/**
 * The house eyebrow — the small uppercase tracked label that sits above
 * headings, date groups, and question screens. One component, two worlds:
 *
 *   `app`   — shell surfaces (activity feed date headers, calendar rails,
 *             info panels): muted-foreground on the theme background.
 *   `brand` — the red accent eyebrow (Home/Insights section labels): the
 *             Claude-coral highlight over a heading, used sparingly.
 *   `guest` — the warm-cream guest world (wizard, welcome, public booking):
 *             warm gray ink on cream.
 *
 * Before this existed the pattern was hand-rolled in 10+ files with
 * tracking drifting between 0.14em and 0.2em.
 */
const eyebrowTone = {
  app: "text-muted-foreground",
  brand: "text-accent-red",
  guest: "text-guest-ink-faint",
} as const

function Eyebrow({
  tone = "app",
  className,
  ...props
}: React.ComponentProps<"p"> & { tone?: keyof typeof eyebrowTone }) {
  return (
    <p
      data-slot="eyebrow"
      className={cn(
        "text-xs font-medium tracking-[0.18em] uppercase",
        eyebrowTone[tone],
        className
      )}
      {...props}
    />
  )
}

export { Eyebrow }
