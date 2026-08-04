import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Breadcrumb trail for the 44px topbar. Notion's crumbs are 14px: ancestors
 * in secondary ink, the current page in primary ink, separated by a faint
 * slash. Hovering a crumb changes the FILL only (docs/notion-spec.md §6) —
 * never the label color, never a border.
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
        "flex min-w-0 items-center gap-0.5 text-sm font-medium",
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const inner = (
          <span
            className={cn(
              "flex items-center gap-1.5 truncate",
              isLast ? "text-foreground" : "text-secondary-ink",
            )}
          >
            {item.icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center text-faint-foreground [&_svg]:size-4">
                {item.icon}
              </span>
            ) : null}
            <span className="truncate">{item.label}</span>
          </span>
        );

        return (
          <span
            key={`${item.label}-${i}`}
            className="flex min-w-0 items-center gap-0.5"
          >
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="flex min-w-0 items-center rounded-md px-1 py-0.5 transition-[background-color] outline-none hover:bg-accent focus-visible:shadow-focus"
              >
                {inner}
              </Link>
            ) : (
              <span className="px-1 py-0.5">{inner}</span>
            )}
            {!isLast ? (
              <span
                aria-hidden="true"
                className="shrink-0 text-faint-foreground select-none"
              >
                /
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
