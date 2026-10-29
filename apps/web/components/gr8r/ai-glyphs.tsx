import type { TintTone } from "@/components/ui/tint-card";

/**
 * Assistant project tints (the house `TintTone` cycle) → gr8r palette tokens,
 * for `.pico` / `.picon` tiles (`--g8-c`). Shared by the Assistant sidebar
 * body, projects list and project home.
 */
export const TINT_G8: Record<string, string> = {
  lavender: "var(--g8-violet)",
  blue: "var(--g8-blue)",
  sage: "var(--g8-green)",
  coral: "var(--g8-orange)",
  honey: "var(--g8-amber)",
};

export function tintVar(tone: TintTone | string): React.CSSProperties {
  return { "--g8-c": TINT_G8[tone] ?? "var(--g8-violet)" } as React.CSSProperties;
}

/** House badge tone (`FleetTone` / `StatusBadge` tones) → gr8r `.badge` modifier. */
const TONE_CLASS: Record<string, string> = {
  neutral: "gray",
  success: "green",
  warning: "amber",
  info: "accent",
  danger: "red",
  violet: "violet",
};

/** gr8r `.badge` with a leading dot, driven by our tone vocabulary. */
export function G8Badge({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: string;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${TONE_CLASS[tone] ?? "gray"}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}
