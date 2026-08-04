import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Inline tag. Notion's inline tags are 6px RECTS, not capsules — the old
 * `rounded-4xl` fake-pill is gone, as is the dead `border border-transparent`
 * on every badge. Tones separate by warm-tinted FILL; only `outline` draws a
 * boundary, and it does so with the 1px warm ring (box-shadow), not a stroke.
 * 12px / weight 500 per the type ramp.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[background-color,box-shadow] focus-visible:shadow-focus has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:shadow-[0_0_0_1px_var(--destructive)] [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-accent-pressed",
        destructive:
          "bg-destructive/10 text-destructive dark:bg-destructive/20 [a]:hover:bg-destructive/20",
        outline: "text-foreground shadow-ring [a]:hover:bg-accent",
        success:
          "bg-success/10 text-success dark:bg-success/15 [a]:hover:bg-success/20",
        warning:
          "bg-warning/10 text-warning dark:bg-warning/15 [a]:hover:bg-warning/20",
        info: "bg-info/10 text-info dark:bg-info/15 [a]:hover:bg-info/20",
        ghost: "text-muted-foreground hover:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
