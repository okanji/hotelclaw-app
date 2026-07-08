import { cn } from "@/lib/utils"

/**
 * Styled native <select> — matches the Input primitive's metrics (h-8,
 * rounded-lg, border-input, 16px on mobile / 14px from md:) and replaces the
 * platform chevron with one consistent glyph. Use this for every plain
 * option list; reach for a menu component only when options need rich
 * content. `wrapperClassName` sizes the control (the wrapper owns width).
 */
function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span
      data-slot="native-select"
      className={cn(
        "inline-grid w-full grid-cols-[1fr_--spacing(8)]",
        wrapperClassName
      )}
    >
      <select
        className={cn(
          "col-span-full row-start-1 h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 8 5"
        width="8"
        height="5"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none col-start-2 row-start-1 place-self-center text-muted-foreground"
      >
        <path d="M.5.5 4 4 7.5.5" stroke="currentcolor" />
      </svg>
    </span>
  )
}

export { NativeSelect }
