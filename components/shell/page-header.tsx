import { cn } from "@/lib/utils";

/**
 * Top bar inside the inset card — sits flush against the inset's rounded top
 * corners, divides the chrome from page content with a 1px hairline.
 *
 * Linear-style: 44px tall, page title left, action area right.
 */
export function PageHeader({
  title,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <h1 className="truncate text-[13px] font-medium text-foreground">
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}
