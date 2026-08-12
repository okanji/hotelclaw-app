import type { FormBackground } from "@/lib/forms/schema";

/**
 * Fill-page background tints (ClickUp's Colors → Background swatches),
 * mapped onto the design system's tint tokens — never raw hex.
 */
export const FORM_BACKGROUND_CLASSES: Record<FormBackground, string> = {
  default: "bg-background",
  lavender: "bg-tint-lavender",
  blue: "bg-tint-blue",
  sage: "bg-tint-sage",
  coral: "bg-tint-coral",
  honey: "bg-tint-honey",
};

export const FORM_BACKGROUND_LABELS: Record<FormBackground, string> = {
  default: "None",
  lavender: "Lavender",
  blue: "Blue",
  sage: "Sage",
  coral: "Coral",
  honey: "Honey",
};
