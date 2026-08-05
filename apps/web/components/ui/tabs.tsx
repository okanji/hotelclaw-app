"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * Tabs — in-place content panels. The strip is Notion's **view-tab pill row**
 * (notion-spec-v2 §6): no container fill, no segmented-control well, no
 * underline. Each tab is a 32px / 20px-radius pill whose active fill is the
 * warm hover fill.
 *
 * Both `variant` keys survive so call sites keep compiling; neither paints a
 * container any more (`default` used to be a `bg-muted` segmented control, and
 * `line` used to draw a 2px underline marker — v2 deletes both).
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-start gap-1 text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        line: "bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // The measured view-tab pill: 32px tall, 20px radius, 6px 12px
        // padding, 14px weight 500. No elevation on the active tab, no
        // underline marker, no label colour flip on hover — hover is a fill.
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-modal px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start focus-visible:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // The active pill's resting fill IS the warm hover fill.
        "hover:bg-accent data-active:bg-accent data-active:text-foreground data-active:hover:bg-accent-pressed",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
