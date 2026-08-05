"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        // Plain low-alpha scrim. The blur lives on the PANEL, not here
        // (notion-spec-v2 §5) — see SheetContent's `backdrop-blur-modal`.
        "fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Width cap for left/right sheets. `sm` is the historical default (384px) and
 * is what every existing call site gets. The prop exists so a wider panel can
 * be asked for by name instead of fighting the `data-[side=*]:sm:max-w-*`
 * variant stack from a `className` (which tailwind-merge cannot dedupe).
 */
const sheetSideWidth = {
  sm: "data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
  md: "data-[side=left]:sm:max-w-md data-[side=right]:sm:max-w-md",
  lg: "data-[side=left]:sm:max-w-lg data-[side=right]:sm:max-w-lg",
  xl: "data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl",
  full: "data-[side=left]:w-full data-[side=right]:w-full",
} as const

function SheetContent({
  className,
  children,
  side = "right",
  size = "sm",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  size?: keyof typeof sheetSideWidth
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // MODAL TIER (notion-spec-v2 §5), edge-anchored. A sheet IS a modal
          // that happens to be pinned to one edge, so it gets the modal
          // surface — translucent `bg-modal-bg` over a 40px backdrop blur plus
          // the deep modal shadow — and the 20px modal radius on its two
          // FLOATING corners only (the pinned edge stays square, since a
          // radius against the viewport edge reads as a rendering bug). No
          // `border-*` on any side. Entrance is an 8px slide (was 40px, a
          // stock-library swoop).
          "fixed z-50 flex flex-col gap-4 bg-modal-bg bg-clip-padding text-sm text-foreground shadow-modal backdrop-blur-modal transition duration-150 ease-in-out data-[side=bottom]:rounded-t-modal data-[side=left]:rounded-r-modal data-[side=right]:rounded-l-modal data-[side=top]:rounded-b-modal data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:data-ending-style:translate-y-2 data-[side=bottom]:data-starting-style:translate-y-2 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:data-ending-style:-translate-x-2 data-[side=left]:data-starting-style:-translate-x-2 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:data-ending-style:translate-x-2 data-[side=right]:data-starting-style:translate-x-2 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:data-ending-style:-translate-y-2 data-[side=top]:data-starting-style:-translate-y-2",
          sheetSideWidth[size],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        // 16px / weight 600, one type voice (no separate heading family).
        "text-base font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
