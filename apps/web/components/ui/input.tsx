import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Notion text field (docs/notion-spec.md §4/§6): 28px tall, 6px radius,
 * 14px text, transparent on light / faintest fill on dark, boundary is the
 * 1px warm RING carried as a box-shadow — never a border. Focus is 1px
 * Notion blue inset + outer; placeholder sits at faint ink.
 *
 * `bare` strips the shell (height, radius, ring, focus, fill) for controls
 * that live INSIDE another bordered container — InputGroup owns the whole
 * boundary in that case. Default `false`, so every existing call site is
 * unchanged.
 */
function Input({
  className,
  type,
  bare = false,
  ...props
}: React.ComponentProps<"input"> & { bare?: boolean }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 bg-transparent text-base outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-faint-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        !bare &&
          "h-7 rounded-md px-2 py-1 shadow-ring transition-[background-color,box-shadow] focus-visible:shadow-focus disabled:bg-muted aria-invalid:shadow-[0_0_0_1px_var(--destructive)] dark:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Input }
