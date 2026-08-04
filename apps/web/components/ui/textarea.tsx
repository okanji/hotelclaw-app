import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Multi-line sibling of Input — same 6px radius, warm ring, blue focus.
 * `bare` strips the shell for controls nested inside an InputGroup.
 */
function Textarea({
  className,
  bare = false,
  ...props
}: React.ComponentProps<"textarea"> & { bare?: boolean }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full bg-transparent text-base outline-none placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        !bare &&
          "rounded-md px-2 py-1.5 shadow-ring transition-[background-color,box-shadow] focus-visible:shadow-focus disabled:bg-muted aria-invalid:shadow-[0_0_0_1px_var(--destructive)] dark:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
