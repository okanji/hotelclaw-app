import { cn } from "@/lib/utils"

/**
 * The house stat strip — divider-separated metrics, not cards. Whitespace
 * and the big-number/small-label contrast do the separating; a hairline
 * divider appears between columns only where the grid needs it.
 *
 * Rules baked in (so every dashboard stops re-deciding them):
 *   - labels never wrap (`truncate`), values use `tabular-nums`
 *   - no icons inside stats — plain label + value (+ optional delta)
 *   - dividers are opacity-based and reset correctly when the column
 *     count collapses on small screens
 *
 * Usage:
 *   <StatGroup cols={4}>
 *     <Stat label="Covers tonight" value={82} />
 *     <Stat label="Pending" value={5} delta="+2 today" tone="warning" />
 *   </StatGroup>
 */
function StatGroup({
  cols = 4,
  className,
  children,
}: {
  /** Desktop column count; collapses to 2 below `sm`. */
  cols?: 2 | 3 | 4
  className?: string
  children: React.ReactNode
}) {
  return (
    <dl
      data-slot="stat-group"
      className={cn(
        "grid grid-cols-2 gap-y-6",
        // Vertical hairlines between columns, per column-count. Items not in
        // the first column get a left divider; the 2-col mobile pattern is
        // shared, then re-derived at `sm` for the real column count.
        "*:border-border/60 *:[&:nth-child(2n)]:border-l *:[&:nth-child(2n)]:pl-6",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 &&
          "sm:grid-cols-3 sm:*:[&:nth-child(2n)]:border-l-0 sm:*:[&:nth-child(2n)]:pl-0 sm:*:not-[&:nth-child(3n+1)]:border-l sm:*:not-[&:nth-child(3n+1)]:pl-6",
        cols === 4 &&
          "sm:grid-cols-4 sm:*:[&:nth-child(2n)]:border-l-0 sm:*:[&:nth-child(2n)]:pl-0 sm:*:not-[&:nth-child(4n+1)]:border-l sm:*:not-[&:nth-child(4n+1)]:pl-6",
        className
      )}
    >
      {children}
    </dl>
  )
}

function Stat({
  label,
  value,
  delta,
  tone = "neutral",
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Small context line under the value ("+2 today", "of 120 tickets"). */
  delta?: React.ReactNode
  /** Colors the delta line only — the value always stays foreground. */
  tone?: "neutral" | "success" | "warning" | "danger"
  className?: string
}) {
  return (
    <div data-slot="stat" className={cn("min-w-0", className)}>
      <dt className="truncate text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </dd>
      {delta ? (
        <dd
          className={cn(
            "mt-0.5 truncate text-xs tabular-nums",
            tone === "neutral" && "text-muted-foreground",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-destructive"
          )}
        >
          {delta}
        </dd>
      ) : null}
    </div>
  )
}

export { StatGroup, Stat }
