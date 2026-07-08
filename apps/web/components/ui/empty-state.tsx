import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The house empty state: dashed well, muted circular icon, one-line title,
 * short pretty-wrapped body, optional action. Every "nothing here yet"
 * moment renders through this so the sizes stop drifting (they ranged
 * size-10–12 wells / 40–46ch bodies before).
 */
function EmptyState({
  icon: Icon,
  title,
  action,
  bare = false,
  className,
  children,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  /** Optional CTA rendered under the copy. */
  action?: React.ReactNode
  /** Drop the dashed container (for hero/full-page empties). */
  bare?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-14 text-center",
        !bare && "rounded-lg border border-dashed border-border",
        className
      )}
    >
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children ? (
          <p className="mx-auto max-w-[44ch] text-sm text-pretty text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
