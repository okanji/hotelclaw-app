import { cn } from "@/lib/utils"
import { Eyebrow } from "@/components/ui/eyebrow"

/**
 * The house section header — title on the left, actions on the right,
 * optional one-line description underneath. This exact flex row is
 * hand-rolled ~70 times across list/index pages; new surfaces should
 * render it through this instead.
 *
 * Sizing follows the DESIGN.md type ramp:
 *
 *   `page`    — the masthead tier (Claude-dashboard editorial pattern):
 *               optional Eyebrow kicker, `font-serif text-4xl font-medium`
 *               display title, and a `text-base` lede capped at a readable
 *               measure. Use once per page, at the top.
 *   `section` — (default) `text-xl font-semibold tracking-tight`.
 *   `panel`   — panel/card-title tier, `text-base font-medium`.
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
  /** Small uppercase kicker above the title (any tier). */
  eyebrow?: React.ReactNode
  /** `brand` renders the red accent eyebrow (Home/Insights mastheads). */
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
          <Eyebrow tone={eyebrowTone} className="mb-1">
            {eyebrow}
          </Eyebrow>
        ) : null}
        {size === "page" ? (
          <h1 className="font-serif text-4xl font-medium tracking-tight text-balance text-foreground">
            {title}
          </h1>
        ) : size === "section" ? (
          <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        ) : (
          <h3 className="truncate text-base font-medium text-foreground">
            {title}
          </h3>
        )}
        {description ? (
          <p
            className={cn(
              "text-pretty text-muted-foreground",
              size === "page"
                ? "mt-1 max-w-[52ch] text-base leading-relaxed tracking-tight"
                : "mt-0.5 text-sm"
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
            size === "page" && "mt-1.5"
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export { SectionHeader }
