/**
 * Shared recharts styling for the Insights section (and the Home pulse
 * widget, which imports it) — every value comes off the token layer, so a
 * theme switch and any future retune follow for free.
 *
 * Notion normalization (2026-08-04): the tooltip is a FLOATING surface, so it
 * takes the one elevation recipe — 10px radius, `--overlay-shadow` (whose
 * last layer IS the 1px warm ring), and no `border`. Axis ticks moved off
 * 10px: nothing in the app renders below 12px. State colours come from the
 * semantic ramp (`--success` / `--warning` / `--destructive`), never from a
 * raw Tailwind palette shade; the neutral series stay on `--chart-*`.
 */

export const AXIS_TICK = {
  fontSize: 12,
  fill: "var(--color-faint-foreground)",
} as const;

export const TOOLTIP_CURSOR = { stroke: "var(--color-border)" } as const;

export const TOOLTIP_CONTENT_STYLE = {
  borderRadius: "var(--radius-overlay)",
  border: "none",
  boxShadow: "var(--overlay-shadow)",
  background: "var(--color-popover)",
  fontSize: "0.75rem",
} as const;

export const TOOLTIP_LABEL_STYLE = {
  color: "var(--color-faint-foreground)",
} as const;

export const COLOR = {
  done: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-destructive)",
  series1: "var(--chart-1)",
  series2: "var(--chart-2)",
  series3: "var(--chart-3)",
  muted: "var(--color-muted-foreground)",
} as const;
