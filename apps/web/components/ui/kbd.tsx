import { cn } from "@/lib/utils"

/**
 * Shortcut hint — gr8r-studio's `kbd` (styles/gr8r/base.css): 18px, mono
 * 11px, 4px radius, a 1px border with a 1.5px bottom edge on the surface
 * fill, faint ink. Inside a tooltip it inverts with the slab.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] w-fit min-w-[18px] items-center justify-center gap-1 rounded-[4px] border border-b-[1.5px] border-border bg-surface px-[5px] font-mono text-[11px] font-normal text-ink-3 select-none in-data-[slot=tooltip-content]:border-tooltip-foreground/25 in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:text-tooltip-foreground [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
