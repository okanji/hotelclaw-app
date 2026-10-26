import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The ONE place a page's width is decided.
 *
 * A page picks a single width and everything inside it — masthead, toolbar,
 * filters, list, table — shares that edge for the whole length of the page.
 * Do not nest two PageShells with different widths, and do not add a
 * `max-w-*` to something inside one.
 *
 * **Why this exists.** `SectionHeader size="page"` used to carry the 720px
 * document column itself, so a masthead sat at 720 while the content under it
 * kept its own container (`max-w-6xl`, `max-w-[920px]`, `max-w-[820px]`…).
 * Pages ended up with two or three different left edges — the Documents
 * Directory had its title at x=563 and its boards at x=326 — which reads as
 * broken alignment rather than as Notion's prose/data contrast. Notion can do
 * that contrast because a Notion page is mostly prose; ours are a masthead
 * plus a list, so they need one edge.
 *
 * | width     | max-width | use for |
 * |-----------|-----------|---------|
 * | `full`    | none (gutter kept) | index, list, feed and dashboard pages — right-aligned meta hugs the pane edge (Linear's lists) |
 * | `page`    | 960px     | **the default** — detail, create, settings: anything with long lines of reading or form fields |
 * | `prose`   | 720px     | reading surfaces: the document editor, brain pages, rendered reports, meeting notes |
 * | `bleed`   | none      | canvas surfaces that ARE the data view: kanban board, calendar grid, timetable, floor plan, workload. The masthead goes full width too, so the edge still holds. |
 */
/**
 * The page gutter — the content's distance from the pane edge whenever the
 * pane is narrower than the measure. Built in (not per page) so every page
 * sits at the same left edge: pages used to choose between 16px (`px-4` on
 * their scroll box) and 40px (`px-10` on the shell), and the content jumped
 * when you moved between them. The value is the `--page-gutter` token, which
 * `PageHeader`, `PageHeaderRow` and the bleed canvases use too — so the title,
 * the tabs and the content share one left edge.
 */
export const PAGE_GUTTER = "px-(--page-gutter)"

function PageShell({
  width = "page",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  width?: "full" | "page" | "prose" | "bleed"
}) {
  // TWO elements on purpose. The gutter (PAGE_GUTTER) goes on the OUTER box; the measure goes on the INNER one. If the padding
  // sat inside the max-width instead, every page would render a different
  // content width and a different left edge depending on how much padding it
  // happened to declare — measured before this fix: /documents was 960px wide
  // at x=549 (no padding) while /home/org was 848px at x=605 (56px padding).
  // Consistent within each page, but the content visibly jumped when you
  // navigated between them. Now the gutter only bites on narrow viewports and
  // the measure is identical everywhere.
  return (
    <div
      data-slot="page-shell"
      data-width={width}
      className={cn("w-full", width !== "bleed" && PAGE_GUTTER, className)}
      {...props}
    >
      {width === "bleed" ? (
        children
      ) : (
        <div
          data-slot="page-shell-measure"
          className={cn(
            // Anchored LEFT, not centred: the measure caps line length, but the
            // content starts at the same edge as the page title and tabs above
            // it. Prose is the exception — a document reads centred.
            "w-full",
            width === "prose" && "mx-auto",
            width === "page" && "max-w-page",
            width === "prose" && "max-w-content"
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export { PageShell }
