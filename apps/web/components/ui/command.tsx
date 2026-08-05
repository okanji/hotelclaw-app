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
        // pickers) or `CommandDialog`'s modal panel. Painting `bg-popover`
        // here would punch an opaque rectangle through the modal tier's
        // translucent fill. The 10px radius is kept for the popover case;
        // inside the dialog the 20px panel clips it.
        "flex size-full flex-col overflow-hidden rounded-card p-1 text-popover-foreground",
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
          "top-1/3 translate-y-0 overflow-hidden p-0",
          className,
          // The MODAL tier is not a caller decision — the search palette is
          // the canonical modal (notion-spec-v2 §5/§6), so these land AFTER
          // `className` on purpose: a call site that still passes the pre-v2
          // popover recipe (`rounded-overlay shadow-overlay`) would otherwise
          // win the tailwind-merge and quietly demote the palette a tier.
          // Size/position/padding stay overridable; the surface does not.
          "rounded-modal bg-modal-bg shadow-modal backdrop-blur-modal"
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
    // Search-modal grammar (notion-spec-v2 §6): the input is NOT a boxed form
    // control. No fill, no radius, no ring — the row is separated from the
    // results by a single 1px warm hairline, and the query itself is CONTENT
    // (16px), not UI chrome (14px).
    <div
      data-slot="command-input-wrapper"
      className="border-b border-border"
    >
      <div className="flex h-11 items-center gap-2 px-3">
        <SearchIcon className="size-4 shrink-0 text-faint-foreground" />
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "h-full w-full bg-transparent text-base outline-hidden placeholder:text-faint-foreground disabled:cursor-not-allowed disabled:opacity-50",
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
      className={cn("py-6 text-center text-sm", className)}
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
        // Group heading = 12px/12px w500 at TERTIARY ink. The search modal
        // sits one rung darker than a sidebar section label (which is faint)
        // — notion-spec-v2 §6 measured it at `#7d7a75`.
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-1.5 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-xs/[1] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
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
      className={cn("-mx-1 my-1 h-px bg-border", className)}
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
        // Menu row: 28px tall, 6px radius, 3px 6px padding, 14px/16.8px w400.
        // Selection is a warm fill only — no label color flip.
        "group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-1.5 py-[3px] text-sm/[1.2] outline-hidden transition-colors select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
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
        // Shortcut hint: 12px w400 faint, letter-spacing normal.
        "ml-auto text-xs font-normal text-faint-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * The palette's footer bar (notion-spec-v2 §6): 41px tall, sitting under a
 * single 1px warm hairline, carrying 12px faint shortcut hints. Optional —
 * `CommandDialog` does not render one for you; place it as the last child of
 * `<Command>`, after `<CommandList>`.
 */
function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "-mx-1 -mb-1 mt-1 flex h-[41px] shrink-0 items-center gap-3 border-t border-border px-3 text-xs font-normal text-faint-foreground",
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
