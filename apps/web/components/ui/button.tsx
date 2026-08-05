import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Notion control language (docs/notion-spec-v2.md §4/§6 — v2 supersedes v1):
 *   - A button is a CLICKABLE, so it sits on the 6px rung (`rounded-md`).
 *     Never the 4px pill rung (that's `Badge`/`StatusBadge`) and never the
 *     10px card rung. No per-size radius overrides.
 *   - Height ladder: 24px compact (`xs`) · 28px default (`default`/`sm`) ·
 *     32px large (`lg`). 28px is Notion's measured primary-button height and
 *     its menu-item pitch.
 *   - Label is 14px weight 500 (UI-row rung of the type ramp), padding
 *     `0 8px` (`px-2`) at the 28px size — measured, not guessed.
 *   - `default` is NOTION BLUE (`bg-primary` = #2383e2) with the near-white
 *     `--primary-foreground` label. This is the app's ONE loud action; every
 *     other variant is transparent-or-quiet with a warm hover fill.
 *   - No borders. `outline` carries the 1px warm ring as a BOX-SHADOW
 *     (`shadow-ring`) so it never shifts layout.
 *   - No shadows at rest, no press-lift, no label color flip on hover.
 *   - Focus = 1px Notion blue inset + 1px outer (`shadow-focus`), never a
 *     3px offset halo.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow] outline-none select-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[0_0_0_1px_var(--destructive)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "bg-transparent shadow-ring hover:bg-accent aria-expanded:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent-pressed aria-expanded:bg-accent-pressed",
        ghost: "hover:bg-accent aria-expanded:bg-accent",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary-ink underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-7 gap-1.5 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        xs: "h-6 gap-1 px-1.5 text-xs has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
