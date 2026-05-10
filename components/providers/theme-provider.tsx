"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Theme provider for dark/light/system support.
 *
 * `attribute="class"` toggles a `.dark` class on <html>, which Tailwind's
 * dark-mode variant (`dark:`) keys off of.
 *
 * `defaultTheme="system"` respects the OS-level setting until the user
 * makes an explicit choice via the dropdown.
 *
 * `disableTransitionOnChange` avoids the flash-of-wrong-colors during the
 * transition between themes.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
