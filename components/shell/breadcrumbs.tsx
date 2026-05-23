import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Linear-style breadcrumb trail. Each item is either a hyperlink to a
 * parent surface or — for the current page — plain text. Renders as a
 * single line at the section-title size used by `<PageHeader />` so the
 * crumbs slot in where the title used to live.
 */
export type BreadcrumbItem = {
  label: string;
  href?: string;
  icon?: React.ReactNode;
};

export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex min-w-0 items-center gap-1 text-[13px] font-medium",
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const inner = (
          <span
            className={cn(
              "flex items-center gap-1.5 truncate transition-colors",
              isLast
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                {item.icon}
              </span>
            ) : null}
            <span className="truncate">{item.label}</span>
          </span>
        );

        return (
          <span
            key={`${item.label}-${i}`}
            className="flex min-w-0 items-center gap-1"
          >
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="flex min-w-0 items-center rounded px-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
            {!isLast ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
