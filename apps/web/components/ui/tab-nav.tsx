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
 * **Every tab is a PILL now (notion-spec-v2 §6).** Notion has no underlined
 * tabs anywhere — its view switcher (Board / Table / List) is a 32px-tall,
 * 20px-radius pill with `6px 12px` padding and a `14px weight 500` label;
 * the ACTIVE pill is filled with the warm hover fill and inactive ones are
 * transparent. The 2px active marker that `underline` used to draw is
 * **deleted**; hover and active are the same gesture at two strengths.
 *
 * The two variant keys survive so call sites keep compiling, and they still
 * differ in the CONTAINER, not the item:
 * - `underline` (default) — the strip sits on the warm hairline baseline that
 *   separates it from the content below (Notion's collection header). Use for
 *   page-level sub-nav.
 * - `pill` — no baseline, tighter gutter. Dense toolbars and filter strips.
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
        variant === "underline" ? "h-10 gap-1 border-b border-border" : "gap-1",
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
          // The measured view-tab pill: 32px tall, 20px radius, 6px 12px
          // padding, 14px weight 500. Identical in both variants — only the
          // strip around it differs.
          "inline-flex h-8 items-center gap-1.5 rounded-modal px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:shadow-focus",
          // Muted at rest, full ink when active. Hover changes the FILL only,
          // and the active pill's resting fill IS the hover fill.
          "text-muted-foreground hover:bg-accent data-active:bg-accent data-active:text-foreground data-active:hover:bg-accent-pressed",
          "[&_svg]:size-3.5 [&_svg]:shrink-0",
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
