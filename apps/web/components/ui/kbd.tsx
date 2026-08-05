import { cn } from "@/lib/utils"

/**
 * Shortcut hint. Per the type ramp a `⌘⌥L` is 12px weight 400 at FAINT ink
 * on the warm hover fill — no chrome, no shadow, no stroke. It is the
 * quietest thing on any row (notion-spec-v2 §6: the search modal's footer
 * hints are 12px faint), so it deliberately keeps the METADATA rung while
 * the status pills moved up to 14px.
 *
 * Radius is the 4px pill rung, not the 6px clickable rung — a kbd is a tiny
 * tag you can't press.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-pill bg-accent px-1 font-sans text-xs font-normal text-faint-foreground select-none in-data-[slot=tooltip-content]:bg-tooltip-foreground/15 in-data-[slot=tooltip-content]:text-tooltip-foreground [&_svg:not([class*='size-'])]:size-3",
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
