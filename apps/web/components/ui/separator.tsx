"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

/**
 * The house divider: 1px of `--border` — the signature warm ring
 * (`rgba(42,28,0,0.07)`), full panel width (notion-spec §4). Never stack an
 * opacity modifier on it (`bg-border/60`): the token is already a 7% alpha,
 * and diluting it twice makes the divider disappear.
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
