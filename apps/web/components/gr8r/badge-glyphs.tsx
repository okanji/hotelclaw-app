
import type { ReactNode } from "react";

/**
 * gr8r badge helper (Meetings and other Phase 6 surfaces): our
 * house status TONES mapped onto gr8r's `.badge` modifiers (green / amber /
 * red / accent / violet / plain), so a state reads the same as the rest of
 * the gr8r shell. Colours come from gr8r tokens only.
 */
export type G8Tone =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "danger"
  | "violet";

const TONE_CLASS: Record<G8Tone, string> = {
  neutral: "badge",
  success: "badge green",
  warning: "badge amber",
  info: "badge accent",
  danger: "badge red",
  violet: "badge violet",
};

export function G8Badge({
  tone = "neutral",
  dot = true,
  title,
  strike,
  children,
}: {
  tone?: G8Tone;
  dot?: boolean;
  title?: string;
  strike?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={TONE_CLASS[tone]}
      title={title}
      style={strike ? { textDecoration: "line-through" } : undefined}
    >
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}
