"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, CircleAlertIcon, Loader2Icon } from "lucide-react"

/**
 * gr8r toast (overlays.css `.toast`, SPEC §5.7): INVERTED — the fill is the
 * text colour and the ink is text-inv, on both planes — 12.5px, min-height
 * 40, padding 8px 8px 8px 12px, radius 8, gap 10, shadow-pop, max-width 400.
 * Leading 15px icon: success green, error red, warning amber, info neutral.
 * The action button is gr8r's `.ta` (600, 3px 8px, r 5, text-inv 14% hover).
 * `richColors` is neutralised the same way: every type uses the inverted
 * slab and only the icon carries the colour.
 */
const INVERTED = {
  "--normal-bg": "var(--foreground)",
  "--normal-text": "var(--ink-inv)",
  "--normal-border": "transparent",
  "--success-bg": "var(--foreground)",
  "--success-text": "var(--ink-inv)",
  "--success-border": "transparent",
  "--error-bg": "var(--foreground)",
  "--error-text": "var(--ink-inv)",
  "--error-border": "transparent",
  "--warning-bg": "var(--foreground)",
  "--warning-text": "var(--ink-inv)",
  "--warning-border": "transparent",
  "--info-bg": "var(--foreground)",
  "--info-text": "var(--ink-inv)",
  "--info-border": "transparent",
  "--border-radius": "8px",
} as React.CSSProperties

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-[15px] text-g-green" />
        ),
        info: (
          <InfoIcon className="size-[15px]" />
        ),
        warning: (
          <TriangleAlertIcon className="size-[15px] text-g-amber" />
        ),
        error: (
          <CircleAlertIcon className="size-[15px] text-g-red" />
        ),
        loading: (
          <Loader2Icon className="size-[15px] animate-spin" />
        ),
      }}
      style={INVERTED}
      toastOptions={{
        classNames: {
          // `!` is required: sonner ships its own unlayered
          // `[data-sonner-toast][data-styled=true]` rules, which otherwise beat
          // Tailwind's layered utilities regardless of specificity.
          toast:
            "cn-toast min-h-10! max-w-[400px]! gap-2.5! py-2! pr-2! pl-3! text-[12.5px]! shadow-popover!",
          description: "text-ink-inv/75! text-xs!",
          actionButton:
            "h-auto! rounded-[5px]! bg-transparent! px-2! py-[3px]! text-[12.5px]! font-semibold! text-ink-inv! opacity-90 hover:bg-ink-inv/14!",
          cancelButton:
            "h-auto! rounded-[5px]! bg-transparent! px-2! py-[3px]! text-[12.5px]! text-ink-inv/75! hover:bg-ink-inv/14!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
