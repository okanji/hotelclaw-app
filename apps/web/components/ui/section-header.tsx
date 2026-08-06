import { cn } from "@/lib/utils"
import { Eyebrow } from "@/components/ui/eyebrow"

/**
 * The house section header — title on the left, actions on the right,
 * optional one-line description underneath. This exact flex row is
 * hand-rolled ~70 times across list/index pages; new surfaces should
 * render it through this instead.
 *
 * Sizing follows the measured Notion type ramp (docs/notion-spec-v2.md §2):
 *
 *   `page`    — the H1 page title: `40px / 48px` weight **700**, sans,
 *               letter-spacing normal. Use once per page, at the top.
 *               (This used to be a `font-serif text-4xl` display title —
 *               the app shell has no serif voice.)
 *   `section` — (default) the **H2 block**: `24px / 31.2px` weight 600.
 *               v1 sized this 16px; v2 measured 24px off a real Notion H2 and
 *               it is what gives a page its document rhythm.
 *   `panel`   — the 16px / 24px weight-600 sub-section rung, for panel and
 *               card titles that sit *inside* a section.
 *
 * There is no rule, underline, or colored eyebrow on any tier.
 *
 * **SectionHeader imposes NO width.** It used to carry the 720px document
 * column (`mx-auto w-full max-w-content`) so that a masthead sat at 720 while
 * the content under it ran wider. That produced pages with two or three
 * different left edges — the Directory had mastheads at x=563 and boards at
 * x=326 — which reads as broken alignment, not as Notion's prose/data
 * contrast. Notion gets away with it because a Notion page is 90% prose; our
 * pages are a masthead plus a list, so they must share one edge.
 *
 * Width is now owned by ONE wrapper per page: `PageShell` (`ui/page-shell`).
 * A page picks a single width and everything in it — masthead, toolbar,
 * list, table — inherits that edge top to bottom. See DESIGN.md § Page width.
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
    <header
      className={cn(
        "flex items-start justify-between gap-4",
        className
      )}
    >
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
          <h2 className="truncate text-2xl leading-[1.3] font-semibold text-balance text-foreground">
            {title}
          </h2>
        ) : (
          <h3 className="truncate text-base leading-6 font-semibold text-foreground">
            {title}
          </h3>
        )}
        {description ? (
          <p
            className={cn(
              "text-sm text-pretty text-muted-foreground",
              size === "page" && "mt-1 max-w-[64ch]",
              size === "section" && "mt-1.5 max-w-[64ch]",
              size === "panel" && "mt-0.5"
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
            // Actions align with the title's optical center, not its cap top —
            // the taller the title rung, the further down that centre sits.
            size === "page" && "mt-2",
            size === "section" && "mt-0.5"
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export { SectionHeader }
