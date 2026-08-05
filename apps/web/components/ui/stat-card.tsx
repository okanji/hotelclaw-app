"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * Stat card — the dashboard headline stat: a 12px faint label with an optional
 * status pill in the top-right, a **24px weight-600 tabular** value, and a
 * one-line context beneath. Neutral surface only — it is a card, so it takes
 * the 10px `rounded-card` rung and the `shadow-card` tier whose last layer is
 * the warm ring (notion-spec-v2 §4/§5); colour belongs to the pill/semantic
 * state, never the card fill. Render a row of these at the top of a dashboard
 * (2–4 across); dense in-flow metric strips inside widgets stay `ui/stat`
 * (StatGroup) — this is the PAGE-headline tier.
 *
 * Make the whole card a link with `render={<Link href={…} />}` — don't nest
 * buttons inside a linked card.
 */
function StatCard({
  label,
  value,
  sub,
  pill,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  label: React.ReactNode
  value: React.ReactNode
  /** One quiet line under the value ("of $200K limit · resets Aug 1"). */
  sub?: React.ReactNode
  /** Small status chip in the top-right corner ("0% used", "Review"). */
  pill?: React.ReactNode
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs leading-3 font-medium text-faint-foreground">
          {label}
        </span>
        {pill}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xl leading-8 font-semibold text-foreground tabular-nums">
          {value}
        </span>
        {sub ? (
          <span className="truncate text-sm text-muted-foreground">{sub}</span>
        ) : null}
      </div>
    </>
  )

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex min-w-0 flex-col gap-3.5 rounded-card bg-card p-4 text-left shadow-card outline-none",
          // Hover is a FILL change only — no border shift, no shadow, no lift.
          // `bg-secondary` (not `bg-accent`): the card fill is OPAQUE, and the
          // translucent hover token would composite against the page instead
          // of the card, dropping the white surface out from under the text.
          "[&:is(a,button)]:cursor-pointer [&:is(a,button)]:transition-colors [&:is(a,button)]:hover:bg-accent [&:is(a,button)]:focus-visible:shadow-focus",
          className
        ),
        children: body,
      },
      props
    ),
    render,
    state: { slot: "stat-card" },
  })
}

/** Corner chip for StatCard's `pill` slot ("0% used", "Review"). The measured
 *  Notion status pill: 20px tall, 4px radius, `0 6px` padding, 14px weight 500,
 *  the hue at 16% alpha with the same hue darkened for ink (notion-spec-v2 §6).
 *  Subtle by default; `warning` for states that want a soft amber nudge. */
function StatCardPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warning"
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-pill px-1.5 text-sm font-medium whitespace-nowrap",
        tone === "warning"
          ? "bg-pill-warning text-pill-warning-ink"
          : "bg-pill-neutral text-pill-neutral-ink"
      )}
    >
      {children}
    </span>
  )
}

export { StatCard, StatCardPill }
