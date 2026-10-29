"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        // Deliberately NO background: <Command> is always mounted inside a
        // surface that already owns one — `PopoverContent` (combobox/facet
        // pickers, gr8r `.pop`) or `CommandDialog` (gr8r `.palette`). The
        // 10px radius matches `.pop`; padding 4 + 13.5px like `.pop`.
        "flex size-full flex-col overflow-hidden rounded-card p-1 text-[13.5px] text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          // gr8r `.palette` (overlays.css, SPEC §5.6): fixed 12vh from the
          // top, width min(640px, 100vw − 32px), max-height 70vh, no padding
          // (the input row / list / footer own theirs).
          "top-[12vh] flex max-h-[70vh] w-[min(640px,calc(100vw-2rem))] max-w-[min(640px,calc(100vw-2rem))] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(640px,calc(100vw-2rem))]",
          className,
          // The surface is not a caller decision: surface fill, radius 12,
          // shadow-pop (its last layer is the 1px ring). Lands AFTER
          // `className` so a stale recipe can't win the tailwind-merge.
          "rounded-[12px] bg-surface shadow-popover"
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    // gr8r `.pop .pin` (overlays.css): a borderless search field on a row
    // separated from the results by a 1px divider; 13.5px query. The ⌘K
    // palette restyles this row as `.pal-in` (50px, 14.5px) from its own
    // className — see components/shell/command-palette.tsx.
    <div
      data-slot="command-input-wrapper"
      className="border-b border-divider"
    >
      <div
        data-slot="command-input-row"
        className="flex h-9 items-center gap-2 px-2"
      >
        <SearchIcon className="size-3.5 shrink-0 text-ink-4" />
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "h-full w-full bg-transparent text-[13.5px] outline-hidden placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
      </div>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-[13.5px] text-ink-3", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        // gr8r `.mh` heading: 11px/600 uppercase, .06em, text-3, 8px 8px 4px.
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[11px]/[1.2] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:tracking-[0.06em] **:[[cmdk-group-heading]]:text-ink-3 **:[[cmdk-group-heading]]:uppercase",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px bg-divider", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        // gr8r `.mi`: min-height 30, padding 0 8, gap 9, r-sm 6, 13.5px,
        // highlight surface-2, 15px icons in text-2, disabled .45.
        "group/command-item relative flex min-h-[30px] cursor-default items-center gap-[9px] rounded-md px-2 text-[13.5px]/[1.2] outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-selected:bg-surface-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px] [&_svg:not([class*='text-'])]:text-ink-2",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto size-3.5 text-primary opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        // gr8r `.mi .r`: right-aligned 12px text-3 meta.
        "ml-auto flex items-center gap-1 text-xs font-normal text-ink-3",
        className
      )}
      {...props}
    />
  )
}

/**
 * The palette's footer bar — gr8r `.pal-f`: sunken fill under a 1px border,
 * padding 8px 14px, 12px text-3 hints spaced 14px apart. Optional —
 * `CommandDialog` does not render one for you; place it as the last child of
 * `<Command>`, after `<CommandList>`.
 */
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "-mx-1 -mb-1 mt-1 flex shrink-0 items-center gap-3.5 border-t border-border bg-sunken px-3.5 py-2 text-xs font-normal text-ink-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
