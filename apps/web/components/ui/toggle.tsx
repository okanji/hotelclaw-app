"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Notion toggle button: 6px radius everywhere (it is a CLICKABLE, so it stays
 * off both the 4px pill rung and the 10px card rung), fill-only hover
 * (`bg-accent`) with no label color flip, pressed state = the pressed warm
 * rung (`bg-accent-pressed`), 1px blue focus. The `outline` variant carries
 * the warm ring as a box-shadow, not a border. Label is 14px weight 500 at
 * every size — the UI rung of the type ramp.
 *
 * The pressed state is deliberately WARM, not Notion blue. Blue marks a
 * SELECTION (checkbox/switch/radio) or the one primary action; a toggle is a
 * view/format control, and Notion's own toolbar + view-tab actives are the
 * warm hover fill (notion-spec-v2 §6). Do not "fix" this to `bg-primary`.
 */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow] outline-none hover:bg-accent focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[0_0_0_1px_var(--destructive)] aria-pressed:bg-accent-pressed data-[state=on]:bg-accent-pressed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "bg-transparent shadow-ring",
      },
      size: {
        default:
          "h-7 min-w-7 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-6 min-w-6 px-2 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
