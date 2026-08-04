import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The house empty state — quiet, small, uncontained. A bare faint icon, a
 * 14px title, a short pretty-wrapped body, optional action.
 *
 * **Reversed 2026-08-04 (notion-spec §1):** this used to be a dashed gray box
 * with a `size-12 rounded-full bg-muted` icon plate — the single most
 * recognizable stock-library artifact in the primitive set. There is no
 * dashed stroke and no icon plate any more; the container, when present, is
 * a 4% warm well at the 6px control radius.
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
  /** Drop the well entirely (for hero/full-page empties). */
  bare?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 px-6 py-10 text-center",
        !bare && "rounded-md bg-muted",
        className
      )}
    >
      {Icon ? <Icon className="size-5 text-faint-foreground" /> : null}
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
