import { cn } from "@/lib/utils"

/**
 * The house stat strip — whitespace-separated metrics, not cards and NOT
 * rule-separated. The vertical hairlines between columns are gone
 * (notion-spec §1: surfaces separate by fill and space, never by a gray
 * stroke); the gutters stay, so the rhythm is unchanged.
 *
 * Rules baked in (so every dashboard stops re-deciding them):
 *   - label is the 12px/12px weight-500 FAINT section-label rung, sentence
 *     case, letter-spacing normal; the value is 24px weight 600 tabular-nums
 *   - labels never wrap (`truncate`)
 *   - no icons inside stats — plain label + value (+ optional delta)
 *   - no card chrome: no fill, no ring, no shadow
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
        // Whitespace only — the column gutters do the separating. The 2-col
        // mobile gutter is shared, then re-derived at `sm` for the real
        // column count so the first column of each row stays flush.
        "grid grid-cols-2 gap-y-6",
        "*:[&:nth-child(2n)]:pl-6",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 &&
          "sm:grid-cols-3 sm:*:[&:nth-child(2n)]:pl-0 sm:*:not-[&:nth-child(3n+1)]:pl-6",
        cols === 4 &&
          "sm:grid-cols-4 sm:*:[&:nth-child(2n)]:pl-0 sm:*:not-[&:nth-child(4n+1)]:pl-6",
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
      <dt className="truncate text-xs leading-3 font-medium text-faint-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-semibold text-foreground tabular-nums">
        {value}
      </dd>
      {delta ? (
        <dd
          className={cn(
            "mt-1 truncate text-xs tabular-nums",
            tone === "neutral" && "text-faint-foreground",
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
