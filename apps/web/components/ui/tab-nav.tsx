"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * The house tab strip for NAVIGATION — route-level sub-nav (`render` a
 * <Link>) or local view/filter switches (default <button>). Distinct from
 * `ui/tabs`, which is for in-place content panels (Base UI Tabs with
 * TabsContent); TabNav renders no panels and owns no state — the caller
 * derives `active` from the pathname or its own state.
 *
 * Two variants, matching the Notion/Claude-dashboard patterns:
 * - `underline` (default) — quiet text over a hairline baseline, ink
 *   underline on the active item. Page-level sub-navigation.
 * - `pill` — compact rounded-full filter chips with a soft ink wash when
 *   active. Dense toolbars (status filters, view modes).
 */
function TabNav({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<"nav"> & { variant?: "underline" | "pill" }) {
  return (
    <nav
      role="tablist"
      data-slot="tab-nav"
      data-variant={variant}
      className={cn(
        "group/tab-nav flex shrink-0 items-center",
        variant === "underline"
          ? "h-9 gap-1 border-b border-border/60"
          : "gap-0.5",
        className
      )}
      {...props}
    />
  )
}

function TabNavItem({
  className,
  active = false,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  /** The caller derives this — from the pathname for nav, state for filters. */
  active?: boolean
}) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        type: "button",
        role: "tab",
        "aria-selected": active,
        className: cn(
          "relative inline-flex items-center gap-1.5 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "text-muted-foreground hover:text-foreground data-active:text-foreground",
          "[&_svg]:size-3.5 [&_svg]:shrink-0",
          // underline: full-height hit area, ink baseline marker on active
          "group-data-[variant=underline]/tab-nav:h-full group-data-[variant=underline]/tab-nav:rounded-md group-data-[variant=underline]/tab-nav:px-2.5 group-data-[variant=underline]/tab-nav:text-sm",
          "group-data-[variant=underline]/tab-nav:after:absolute group-data-[variant=underline]/tab-nav:after:inset-x-2 group-data-[variant=underline]/tab-nav:after:-bottom-px group-data-[variant=underline]/tab-nav:after:h-0.5 group-data-[variant=underline]/tab-nav:after:rounded-full group-data-[variant=underline]/tab-nav:after:bg-foreground group-data-[variant=underline]/tab-nav:after:opacity-0 group-data-[variant=underline]/tab-nav:data-active:after:opacity-100",
          // pill: compact filter chip with a soft ink wash
          "group-data-[variant=pill]/tab-nav:h-6 group-data-[variant=pill]/tab-nav:rounded-full group-data-[variant=pill]/tab-nav:px-2.5 group-data-[variant=pill]/tab-nav:text-xs",
          "group-data-[variant=pill]/tab-nav:hover:bg-foreground/[0.05] group-data-[variant=pill]/tab-nav:data-active:bg-foreground/[0.08]",
          className
        ),
        ...(active ? { "data-active": "" } : {}),
      },
      props
    ),
    render,
    state: {
      slot: "tab-nav-item",
    },
  })
}

export { TabNav, TabNavItem }
