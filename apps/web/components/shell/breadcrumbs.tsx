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
  // gr8r `crumbs()` (shell/layout.js): ancestors in text-2 (colour-only
  // hover), the current page `.cur` (text, 500), a faint `/` `.sep`.
  return (
    <nav aria-label="Breadcrumb" className={cn("crumbs trunc", className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const inner = (
          <>
            {item.icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5">
                {item.icon}
              </span>
            ) : null}
            <span className="trunc">{item.label}</span>
          </>
        );
        return (
          <span key={`${item.label}-${i}`} className="contents">
            {item.href && !isLast ? (
              <Link href={item.href} className="crumb">
                {inner}
              </Link>
            ) : (
              <span className={isLast ? "crumb cur" : "crumb"}>{inner}</span>
            )}
            {!isLast ? (
              <span aria-hidden="true" className="sep">
                /
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
