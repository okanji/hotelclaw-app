"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            // gr8r `.pop` (overlays.css, SPEC §5.4): surface fill, r-lg 10px,
            // shadow-pop (its last layer is the 1px ring, so no border), 4px
            // padding, min-width 200, max-height min(420px, 70vh), 13.5px.
            // Enter = popIn (0.16s, translateY(-4px) scale(.97)); exit is a
            // quick fade (gr8r removes popovers instantly).
            "z-50 max-h-[min(420px,70vh,var(--available-height))] w-(--anchor-width) min-w-[200px] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1 text-[13.5px] text-popover-foreground shadow-popover duration-100 outline-none data-open:animate-[g-pop-in_160ms_var(--ease-g)_both] data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        // gr8r `.mh`: 11px/600 uppercase, .06em tracking, text-3, 8px 8px 4px.
        "px-2 pt-2 pb-1 text-[11px]/[1.2] font-semibold tracking-[0.06em] text-ink-3 uppercase data-inset:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        // gr8r `.mi`: min-height 30, padding 0 8, gap 9, r-sm 6, 13.5px,
        // highlight surface-2; 15px icons in text-2; `.danger` is red text +
        // red icon with the same neutral highlight; disabled .45.
        "group/dropdown-menu-item relative flex min-h-[30px] cursor-default items-center gap-[9px] rounded-md text-[13.5px]/[1.2] text-popover-foreground outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] px-2 not-data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-ink-2 data-[variant=destructive]:text-destructive data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        // gr8r `.mi` row; the open submenu keeps the highlight.
        "relative flex min-h-[30px] cursor-default items-center gap-[9px] rounded-md text-[13.5px]/[1.2] text-popover-foreground outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] px-2 [&_svg:not([class*='text-'])]:text-ink-2 data-popup-open:bg-surface-2 data-open:bg-surface-2",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 text-ink-3" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      // Submenus share the ONE overlay recipe inherited from DropdownMenuContent.
      className={cn("w-auto", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-[30px] cursor-default items-center gap-[9px] rounded-md text-[13.5px]/[1.2] text-popover-foreground outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] pr-8 pl-2 [&_svg:not([class*='text-'])]:text-ink-2",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center text-primary"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-3.5 text-primary" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex min-h-[30px] cursor-default items-center gap-[9px] rounded-md text-[13.5px]/[1.2] text-popover-foreground outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-inset:pl-8 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] pr-8 pl-2 [&_svg:not([class*='text-'])]:text-ink-2",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center text-primary"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon className="size-3.5 text-primary" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      // gr8r `.msep`: 1px divider, margin 4px -4px.
      className={cn("-mx-1 my-1 h-px bg-divider", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        // gr8r `.mi .r`: right-aligned 12px text-3 meta (kbds sit inside).
        "ml-auto flex items-center gap-1 text-xs font-normal text-ink-3",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
