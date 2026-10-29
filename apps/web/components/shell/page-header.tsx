import { cn } from "@/lib/utils";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";
import { TopbarActions } from "./topbar-actions";

/**
 * The app topbar. Notion's is **44px tall and completely transparent** — no
 * fill, no bottom border, no shadow (docs/notion-spec.md §4). Page content
 * separates from it by whitespace alone, so the chrome disappears and the
 * content column is the only thing with weight.
 *
 * Left: page title (14px/500 primary ink) or a breadcrumb trail for nested
 * pages. `meta` is the quiet status slot beside it ("Edited 2y ago") at 14px
 * faint. Right: ghost icon actions.
 *
 * **This is the ONE page header (Linear's compact bar), app-wide.** Every page
 * under `/p/[propertyId]` opens with it — no 40px mastheads, no ledes. Index
 * pages pass `title` + `icon`; detail pages pass `breadcrumbs` (or a bespoke
 * trail through `start`). Tabs / filters go in a `PageHeaderRow` directly
 * below, only when the page has them. See DESIGN.md § Page header.
 */
export function PageHeader({
  title,
  icon,
  meta,
  breadcrumbs,
  start,
  actions,
  className,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  /** Quiet status text beside the title — 14px faint, never competes. */
  meta?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /**
   * Custom left content in place of `title` / `breadcrumbs` — for a trail the
   * `Breadcrumbs` items can't express (an emoji or color-dot entity crumb).
   */
  start?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  // gr8r `renderTopbar()` (shell/layout.js): `.topbar` (46px, surface,
  // hairline bottom, content on the gutter) › `.crumbs` › spacer › page
  // actions › search / bell / New (`TopbarActions`).
  return (
    <header
      className={cn(
        "topbar",
        // Leave room for LeftShell's fixed » (top-2 left-2, 30px) while the
        // desktop sidebar is collapsed — its root carries
        // `data-sidebar-open` only while attached.
        "md:[body:not(:has([data-sidebar-open]))_&]:pl-11",
        className,
      )}
    >
      {start ? (
        <div className="crumbs trunc">{start}</div>
      ) : breadcrumbs ? (
        <Breadcrumbs items={breadcrumbs} />
      ) : (
        <nav className="crumbs trunc" aria-label="Breadcrumb">
          <h1 className="crumb cur">
            {icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5">
                {icon}
              </span>
            ) : null}
            <span className="trunc">{title}</span>
          </h1>
        </nav>
      )}
      {meta ? <span className="faint hide-m trunc" style={{ fontSize: "var(--g8-fs-sm)" }}>{meta}</span> : null}
      <span className="sp" />
      {actions ? <div className="row" style={{ gap: 2 }}>{actions}</div> : null}
      <TopbarActions />
    </header>
  );
}

/**
 * The optional SECOND row of the compact page header (Linear's view row):
 * view tabs / filters on the left, a quiet count or display options on the
 * right. Same `--page-gutter` as `PageHeader` and `PageShell`, no border — the content below
 * separates by whitespace or its own sticky column header. Only pages that
 * actually have tabs or filters render it.
 */
export function PageHeaderRow({
  children,
  aside,
  className,
}: {
  children?: React.ReactNode;
  /** Right-aligned quiet slot — a count ("12 projects") or display options. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-3 px-(--page-gutter) pb-2",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      {aside ? (
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground tabular-nums">
          {aside}
        </div>
      ) : null}
    </div>
  );
}
