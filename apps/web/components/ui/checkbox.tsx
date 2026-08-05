"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

/**
 * Notion checkbox: 6px radius, 1px warm ring when unchecked (box-shadow, not
 * a border), NOTION BLUE when checked. Focus = 1px blue inset + outer, never
 * a 3px halo.
 *
 * The checked fill is `--primary`, not `--ring`: both are #2383e2 on the
 * light plane, but `--primary` lifts a rung on the dark plane so the tick
 * clears the #191919 canvas at AA. Selection controls and the primary button
 * are the same blue family by design.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-md bg-transparent shadow-ring transition-[background-color,box-shadow] outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:shadow-[0_0_0_1px_var(--destructive)] dark:bg-muted data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
