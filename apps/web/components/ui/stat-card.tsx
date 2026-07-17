"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * Stat card — the Claude-console dashboard headline stat: a quiet label with an
 * optional status pill in the top-right, a big tabular value, and a one-line
 * context beneath. Neutral surface only (subtle border on `bg-card`); colour
 * belongs to the pill/semantic state, never the card fill. Render a row of
 * these at the top of a dashboard (2–4 across); dense in-flow metric strips
 * inside widgets stay `ui/stat` (StatGroup) — this is the PAGE-headline tier.
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
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {pill}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">
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
          "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left outline-none",
          "[&:is(a,button)]:cursor-pointer [&:is(a,button)]:transition-colors [&:is(a,button)]:hover:border-foreground/20 [&:is(a,button)]:hover:bg-muted/20 [&:is(a,button)]:focus-visible:ring-2 [&:is(a,button)]:focus-visible:ring-ring/50",
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

/** Corner chip for StatCard's `pill` slot ("0% used", "Review"). Subtle by
 *  default; `warning` for states that want a soft amber nudge. */
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
        "rounded-lg px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "warning"
          ? "bg-warning/10 text-warning"
          : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  )
}

export { StatCard, StatCardPill }
