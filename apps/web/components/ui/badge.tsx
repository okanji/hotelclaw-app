import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * THE SELECT / STATUS PILL — Notion's single most recognisable small
 * component, and the measured geometry is exact (notion-spec-v2 §6):
 *
 *     20px tall · 4px radius (`rounded-pill`) · padding `0 6px` (`px-1.5`)
 *     · label 14px weight 500 · fill = the hue at ~16% alpha
 *     · ink = the SAME hue darkened (lightened on the dark plane)
 *
 * Two corrections v2 makes to what shipped before it: the radius drops from
 * the 6px clickable rung to the 4px pill rung (a tag is not a button), and
 * the label rises from 12px to 14px — a pill carries a VALUE, so it reads on
 * the UI rung of the type ramp, not the metadata rung.
 *
 * Tone fills come from the `--pill-*` token family, never from `/10`-style
 * alpha maths on the status ramp: the token pair bakes in both the 16% fill
 * AND the per-plane ink, so a tone needs no `dark:` override and can't drift
 * from the ramp. `default` stays the solid Notion-blue emphasis badge and
 * `outline` stays the 1px warm ring (box-shadow, never a stroke).
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-pill px-1.5 text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow] focus-visible:shadow-focus has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:shadow-[0_0_0_1px_var(--destructive)] [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-pill-neutral text-pill-neutral-ink [a]:hover:bg-accent-pressed",
        destructive:
          "bg-pill-danger text-pill-danger-ink [a]:hover:bg-destructive/20",
        outline: "text-foreground shadow-ring [a]:hover:bg-accent",
        success:
          "bg-pill-success text-pill-success-ink [a]:hover:bg-success/20",
        warning:
          "bg-pill-warning text-pill-warning-ink [a]:hover:bg-warning/20",
        info: "bg-pill-info text-pill-info-ink [a]:hover:bg-info/20",
        ghost: "text-muted-foreground hover:bg-accent",
        link: "text-primary-ink underline-offset-4 hover:underline",
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
