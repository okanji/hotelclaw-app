import { cn } from "@/lib/utils"
import { Eyebrow } from "@/components/ui/eyebrow"

/**
 * The house section header — title on the left, actions on the right,
 * optional one-line description underneath. This exact flex row is
 * hand-rolled ~70 times across list/index pages; new surfaces should
 * render it through this instead.
 *
 * Sizing follows the measured Notion type ramp (docs/notion-spec.md §3):
 *
 *   `page`    — the H1 page title: `40px / 48px` weight **700**, sans,
 *               letter-spacing normal. Use once per page, at the top.
 *               (This used to be a `font-serif text-4xl` display title —
 *               the app shell has no serif voice.)
 *   `section` — (default) `16px / 24px` weight 600.
 *   `panel`   — panel/card-title tier, `14px` weight 500.
 *
 * There is no rule, underline, or colored eyebrow on any tier.
 */
function SectionHeader({
  title,
  eyebrow,
  eyebrowTone = "app",
  description,
  actions,
  size = "section",
  className,
}: {
  title: React.ReactNode
  /** Small sentence-case section label above the title (any tier). */
  eyebrow?: React.ReactNode
  /**
   * Kept for source compatibility. Notion has no colored labels, so `brand`
   * now resolves to the same faint ink as `app` (see `ui/eyebrow`).
   */
  eyebrowTone?: "app" | "brand"
  /** Context under the title: one line for section/panel, a lede for page. */
  description?: React.ReactNode
  /** Right-aligned controls (buttons, filters). */
  actions?: React.ReactNode
  size?: "page" | "section" | "panel"
  className?: string
}) {
  return (
    <header className={cn("flex items-start justify-between gap-4", className)}>
      <div className={cn("min-w-0", size === "page" && "flex flex-col gap-1.5")}>
        {eyebrow ? (
          <Eyebrow tone={eyebrowTone} className="mb-1.5">
            {eyebrow}
          </Eyebrow>
        ) : null}
        {size === "page" ? (
          <h1 className="text-[2.5rem] leading-[3rem] font-bold text-balance text-foreground">
            {title}
          </h1>
        ) : size === "section" ? (
          <h2 className="truncate text-base leading-6 font-semibold text-foreground">
            {title}
          </h2>
        ) : (
          <h3 className="truncate text-sm font-medium text-foreground">
            {title}
          </h3>
        )}
        {description ? (
          <p
            className={cn(
              "text-sm text-pretty text-muted-foreground",
              size === "page" ? "mt-1 max-w-[64ch]" : "mt-0.5"
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-end gap-2",
            // Masthead actions align with the title's optical center, not its cap top.
            size === "page" && "mt-2"
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export { SectionHeader }
