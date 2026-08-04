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
 * Two variants, both on the measured Notion metrics (14px weight 500, warm
 * 5% hover fill, 6px radius, no label color flip on hover):
 * - `underline` (default) — quiet muted text over the warm hairline baseline,
 *   with a 2px **primary-ink** marker on the active item. (It used to be
 *   `accent-red`; Notion's active nav is never colored.) Page-level sub-nav.
 * - `pill` — compact 6px filter chips that take the warm hover fill, and the
 *   pressed rung of the same fill when active. Dense toolbars.
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
        variant === "underline" ? "h-9 gap-1 border-b border-border" : "gap-0.5",
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
          "relative inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:shadow-focus",
          // Muted at rest, full ink when active. Hover changes the FILL only.
          "text-muted-foreground data-active:text-foreground",
          "[&_svg]:size-3.5 [&_svg]:shrink-0",
          // underline: full-height hit area, 2px primary-ink marker on active
          "group-data-[variant=underline]/tab-nav:h-full group-data-[variant=underline]/tab-nav:rounded-md group-data-[variant=underline]/tab-nav:px-2.5 group-data-[variant=underline]/tab-nav:hover:bg-accent",
          "group-data-[variant=underline]/tab-nav:after:absolute group-data-[variant=underline]/tab-nav:after:inset-x-2 group-data-[variant=underline]/tab-nav:after:-bottom-px group-data-[variant=underline]/tab-nav:after:h-0.5 group-data-[variant=underline]/tab-nav:after:bg-foreground group-data-[variant=underline]/tab-nav:after:opacity-0 group-data-[variant=underline]/tab-nav:data-active:after:opacity-100",
          // pill: compact 6px filter chip on the warm hover/pressed fills
          "group-data-[variant=pill]/tab-nav:h-7 group-data-[variant=pill]/tab-nav:rounded-md group-data-[variant=pill]/tab-nav:px-2.5",
          "group-data-[variant=pill]/tab-nav:hover:bg-accent group-data-[variant=pill]/tab-nav:data-active:bg-accent-pressed",
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
