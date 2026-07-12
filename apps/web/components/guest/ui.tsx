"use client"

import { cn } from "@/lib/utils"

/**
 * The guest kit — primitives for the warm-cream guest world: the onboarding
 * wizard, /welcome, public booking (/book), the guest chatbot (/g), and
 * event ticket pages. These surfaces are deliberately NOT the app shell's
 * palette and never theme-switch; everything here reads from the `guest-*`
 * tokens in globals.css (single source for the cream/rust/ink values that
 * used to be hardcoded per file).
 *
 * Voice: cream canvas, serif display questions, rust accent, one decision
 * per screen. Use `<Chip tone="guest">` from components/ui/chip.tsx and
 * `<Eyebrow tone="guest">` from components/ui/eyebrow.tsx alongside these.
 */

/** Full-viewport cream canvas that centers a single column of content. */
function GuestShell({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <main
      className={cn(
        "flex min-h-svh items-center justify-center bg-guest-bg px-6 py-16 text-guest-ink",
        className
      )}
    >
      {children}
    </main>
  )
}

/** The big serif question — the display voice of every guest screen. */
function GuestQuestion({
  className,
  ...props
}: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn(
        "font-serif text-3xl text-balance text-guest-ink sm:text-4xl",
        className
      )}
      {...props}
    />
  )
}

/** Short helper copy under a question. */
function GuestHint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-3 text-sm text-pretty text-guest-ink-soft", className)}
      {...props}
    />
  )
}

/** The one primary action per screen — rust pill. */
function GuestPrimaryButton({
  className,
  type = "submit",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "h-11 rounded-full bg-guest-accent px-7 text-sm font-medium text-white transition-colors",
        "hover:bg-guest-accent-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-guest-accent",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-guest-accent",
        className
      )}
      {...props}
    />
  )
}

/** Quiet secondary action (Back, Skip, Cancel). */
function GuestGhostButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "h-11 rounded-full px-4 text-sm text-guest-ink-faint transition-colors hover:text-guest-ink",
        className
      )}
      {...props}
    />
  )
}

/** The big serif underline input (name, property name…). */
function GuestBigInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full border-0 border-b-2 border-guest-line bg-transparent pb-2 font-serif text-2xl text-guest-ink outline-none transition-colors sm:text-3xl",
        "placeholder:text-guest-placeholder focus:border-guest-accent",
        "disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

/** Compact rounded input for secondary fields (emails, free-text adds). */
function GuestInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 rounded-full border border-guest-line bg-guest-card px-4 text-sm text-guest-ink outline-none transition-colors",
        "placeholder:text-guest-placeholder focus:border-guest-accent",
        className
      )}
      {...props}
    />
  )
}

/** Inline error line in the guest voice. */
function GuestError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("mt-4 text-sm text-guest-danger", className)}
      {...props}
    />
  )
}

export {
  GuestShell,
  GuestQuestion,
  GuestHint,
  GuestPrimaryButton,
  GuestGhostButton,
  GuestBigInput,
  GuestInput,
  GuestError,
}
