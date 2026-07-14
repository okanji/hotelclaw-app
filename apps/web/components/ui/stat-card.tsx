"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * Stat card — the Claude-platform dashboard headline stat: quiet label,
 * big tabular value, one-line context, and an optional status pill in the
 * top-right corner. Render one row of these at the top of a dashboard
 * (grid, 2–4 across); dense in-flow metric strips inside widgets stay
 * `ui/stat` (StatGroup) — this is the PAGE-headline tier only.
 *
 * Make the whole card a link with `render={<Link href={…} />}` — don't
 * nest buttons inside a linked card.
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
  /** Small status chip in the top-right corner ("0% used", "Needs a yes"). */
  pill?: React.ReactNode
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        {pill}
      </div>
      <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </span>
      {sub ? (
        <span className="truncate text-sm text-muted-foreground">{sub}</span>
      ) : null}
    </>
  )

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left outline-none",
          "[&:is(a,button)]:cursor-pointer [&:is(a,button)]:transition-colors [&:is(a,button)]:hover:bg-muted/40 [&:is(a,button)]:focus-visible:ring-2 [&:is(a,button)]:focus-visible:ring-ring/50",
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

/** Corner chip for StatCard's `pill` slot ("0% used", "Needs a yes"). */
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
        "rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
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
