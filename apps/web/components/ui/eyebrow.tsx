import { cn } from "@/lib/utils"

/**
 * The house eyebrow — the small section label that sits above headings, date
 * groups, and question screens.
 *
 * **Reversed 2026-08-04 (notion-spec §1.5/§3).** This used to be an uppercase
 * `tracking-[0.18em]` label; that was the single loudest "stock template" tell
 * in the app. The app tiers are now the measured Notion section label:
 * **12px / 12px, weight 500, faint ink, sentence case, letter-spacing normal.**
 * Write the copy in Sentence case — the component no longer shouts for you.
 *
 *   `app`   — (default) shell surfaces: activity date headers, calendar rails,
 *             info panels, editor sidebars.
 *   `brand` — kept as a tone key so existing call sites compile, but Notion
 *             has no colored labels: it now resolves to the same faint ink as
 *             `app`. Prefer `app` in new code.
 *   `guest` — the warm-cream guest world (wizard, welcome, public booking).
 *             **Out of scope for the normalization** — it deliberately keeps
 *             the uppercase + tracked voice and its own 16px line-height.
 */
const eyebrowTone = {
  app: "text-faint-foreground",
  brand: "text-faint-foreground",
  guest: "text-guest-ink-faint uppercase tracking-[0.18em] leading-4",
} as const

function Eyebrow({
  tone = "app",
  className,
  ...props
}: React.ComponentProps<"p"> & { tone?: keyof typeof eyebrowTone }) {
  return (
    <p
      data-slot="eyebrow"
      data-tone={tone}
      className={cn(
        "text-xs leading-3 font-medium",
        eyebrowTone[tone],
        className
      )}
      {...props}
    />
  )
}

export { Eyebrow }
