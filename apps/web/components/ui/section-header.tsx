import { cn } from "@/lib/utils"

/**
 * The house section header — title on the left, actions on the right,
 * optional one-line description underneath. This exact flex row is
 * hand-rolled ~70 times across list/index pages; new surfaces should
 * render it through this instead.
 *
 * Sizing follows the DESIGN.md type ramp: `section` (default) is the
 * section-title tier (`text-xl font-semibold tracking-tight`); `panel` is
 * the panel/card-title tier (`text-base font-medium`).
 */
function SectionHeader({
  title,
  description,
  actions,
  size = "section",
  className,
}: {
  title: React.ReactNode
  /** Short, one-line context under the title. */
  description?: React.ReactNode
  /** Right-aligned controls (buttons, filters). */
  actions?: React.ReactNode
  size?: "section" | "panel"
  className?: string
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {size === "section" ? (
          <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        ) : (
          <h3 className="truncate text-base font-medium text-foreground">
            {title}
          </h3>
        )}
        {description ? (
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export { SectionHeader }
