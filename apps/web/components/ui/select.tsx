"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "cn"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // gr8r `.select` / `.select-btn` (components.css): h-md 30 (sm 26),
        // padding 0 10, r-sm 6, 1px border-strong on surface, 13.5px; hover
        // nudges the border toward text-3; focus AND open = accent border +
        // 3px accent-soft ring; error = red border + red-soft ring.
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-border-strong bg-surface pr-2 pl-2.5 text-[13.5px] whitespace-nowrap transition-[border-color,box-shadow] duration-140 outline-none select-none hover:border-[color:color-mix(in_srgb,var(--border-strong)_60%,var(--ink-3))] focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-accent-soft data-popup-open:border-primary data-popup-open:ring-3 data-popup-open:ring-accent-soft disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 data-placeholder:text-ink-4 data-[size=default]:h-[30px] data-[size=sm]:h-[26px] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-3 text-ink-4" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          // gr8r `.pop.select-menu`: the `.pop` panel (surface, r-lg 10,
          // shadow-pop, 4px padding, max-height min(420px, 70vh)) at
          // min-width max(trigger, 160px), max-width 360; popIn on enter
          // except when the list is aligned over the trigger.
          className={cn("relative isolate z-50 max-h-[min(420px,70vh,var(--available-height))] w-(--anchor-width) max-w-[360px] min-w-[max(var(--anchor-width),160px)] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-card bg-surface p-1 text-[13.5px] text-popover-foreground shadow-popover duration-100 data-open:animate-[g-pop-in_160ms_var(--ease-g)_both] data-[align-trigger=true]:animate-none data-closed:animate-out data-closed:fade-out-0", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      // gr8r `.mh`: 11px/600 uppercase, .06em, text-3, 8px 8px 4px.
      className={cn("px-2 pt-2 pb-1 text-[11px]/[1.2] font-semibold tracking-[0.06em] text-ink-3 uppercase", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // gr8r `.mi` (selected = 500 weight + accent check at the right).
        "relative flex min-h-[30px] w-full cursor-default items-center gap-[9px] rounded-md text-[13.5px]/[1.2] text-popover-foreground outline-hidden select-none focus:bg-surface-2 data-highlighted:bg-surface-2 data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] [&_svg:not([class*='text-'])]:text-ink-2 pr-8 pl-2 data-selected:font-medium *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none size-3.5 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-divider", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
