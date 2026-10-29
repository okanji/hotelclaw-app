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
        // gr8r scrim (`.drawer-scrim.full` / `.scrim`): `--overlay` fill,
        // 0.18s fade.
        "fixed inset-0 z-50 bg-(--overlay) transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0",
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
          // gr8r `.drawer` (overlays.css, SPEC §5.2), edge-anchored: solid
          // surface, square corners, a 1px border on the INNER edge only and
          // the drawer's soft directional shadow (-18px 0 40px -24px, alpha
          // .25 — mirrored per side). Entrance = drawerIn: 48px slide + fade
          // over 0.34s on the drawer ease.
          "fixed z-50 flex flex-col gap-4 bg-surface bg-clip-padding text-[13.5px] text-foreground transition-[opacity,translate] duration-340 ease-(--ease-drawer) data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:shadow-[0_-18px_40px_-24px_rgb(0_0_0/0.25)] data-[side=bottom]:data-ending-style:translate-y-12 data-[side=bottom]:data-starting-style:translate-y-12 data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:shadow-[18px_0_40px_-24px_rgb(0_0_0/0.25)] data-[side=left]:data-ending-style:-translate-x-12 data-[side=left]:data-starting-style:-translate-x-12 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:shadow-[-18px_0_40px_-24px_rgb(0_0_0/0.25)] data-[side=right]:data-ending-style:translate-x-12 data-[side=right]:data-starting-style:translate-x-12 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:shadow-[0_18px_40px_-24px_rgb(0_0_0/0.25)] data-[side=top]:data-ending-style:-translate-y-12 data-[side=top]:data-starting-style:-translate-y-12",
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
        // gr8r overlay title: 14.5px / 600.
        "text-[14.5px] font-semibold text-foreground",
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
      className={cn("text-[12.5px] text-muted-foreground", className)}
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
