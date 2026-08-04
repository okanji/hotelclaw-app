import { cn } from "@/lib/utils";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";

/**
 * The app topbar. Notion's is **44px tall and completely transparent** — no
 * fill, no bottom border, no shadow (docs/notion-spec.md §4). Page content
 * separates from it by whitespace alone, so the chrome disappears and the
 * content column is the only thing with weight.
 *
 * Left: page title (14px/500 primary ink) or a breadcrumb trail for nested
 * pages. `meta` is the quiet status slot beside it ("Edited 2y ago") at 14px
 * faint. Right: ghost icon actions.
 */
export function PageHeader({
  title,
  icon,
  meta,
  breadcrumbs,
  actions,
  className,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  /** Quiet status text beside the title — 14px faint, never competes. */
  meta?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-2 px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {breadcrumbs ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <>
            {icon ? (
              <span className="flex size-5 shrink-0 items-center justify-center text-faint-foreground [&_svg]:size-4">
                {icon}
              </span>
            ) : null}
            <h1 className="truncate text-sm font-medium text-foreground">
              {title}
            </h1>
          </>
        )}
        {meta ? (
          <span className="hidden shrink-0 truncate text-sm text-faint-foreground sm:inline">
            {meta}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      ) : null}
    </header>
  );
}
