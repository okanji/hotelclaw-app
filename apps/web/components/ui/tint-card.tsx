import { cn } from "@/lib/utils"

/**
 * A colored card surface from the brand tint palette (see `--tint-*` in
 * globals.css). The Claude/Anthropic brand panels — lavender / blue / sage /
 * coral / honey — used for the feature tiles on Home + Insights. Theme-adaptive:
 * soft pastel fills on the light plane, deep muted fills on charcoal; the
 * matching `*-ink` text color is applied automatically so content always has
 * contrast on the fill.
 *
 * Use for a small number of accent tiles per view (like the model cards in the
 * Claude console) — NOT for every card. Neutral `Card`/well surfaces stay the
 * default; tint is the highlight.
 */
const tintTone = {
  lavender: "bg-tint-lavender text-tint-lavender-ink",
  blue: "bg-tint-blue text-tint-blue-ink",
  sage: "bg-tint-sage text-tint-sage-ink",
  coral: "bg-tint-coral text-tint-coral-ink",
  honey: "bg-tint-honey text-tint-honey-ink",
} as const

export type TintTone = keyof typeof tintTone

/** Left-accent border color per hue — the saturated ink token, so a bordered
 *  card can carry a bold colored left edge (Claude-console signal-card look)
 *  while its other sides stay neutral. Pair with `border-l-4`. */
export const tintBorderL = {
  lavender: "border-l-tint-lavender-ink",
  blue: "border-l-tint-blue-ink",
  sage: "border-l-tint-sage-ink",
  coral: "border-l-tint-coral-ink",
  honey: "border-l-tint-honey-ink",
} as const

/** Stable rotation so callers can color a list of tiles without picking hues. */
const TINT_CYCLE: TintTone[] = ["lavender", "blue", "sage", "coral", "honey"]
export function tintAt(i: number): TintTone {
  return TINT_CYCLE[((i % TINT_CYCLE.length) + TINT_CYCLE.length) % TINT_CYCLE.length]
}

function TintCard({
  tone = "lavender",
  interactive = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  tone?: TintTone
  /** Adds hover lift + cursor affordance for clickable tiles. */
  interactive?: boolean
}) {
  return (
    <div
      data-slot="tint-card"
      data-tone={tone}
      className={cn(
        "rounded-xl p-4",
        tintTone[tone],
        interactive &&
          "cursor-pointer transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

export { TintCard, tintTone }
