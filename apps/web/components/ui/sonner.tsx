"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          // A toast is floating chrome → the POPOVER tier (notion-spec-v2 §5):
          // no stroke, the 10px card/popover radius, and the popover elevation
          // whose LAST layer is the 1px warm ring.
          "--normal-border": "transparent",
          "--border-radius": "var(--radius-card)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // `!` is required: sonner ships its own unlayered
          // `[data-sonner-toast][data-styled=true]` rules, which otherwise beat
          // Tailwind's layered utilities regardless of specificity.
          toast: "cn-toast shadow-popover! text-sm!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
