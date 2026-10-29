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
 *
 * gr8r port (2026-10-29): values now read gr8r's own tokens (`--g8-*`,
 * defined under the `.g8` shell root every consumer renders inside) — the
 * popover recipe is gr8r's `.pop` (surface, `--shadow-pop` ring, `--r`),
 * axis ink `--text-3`, states green / amber / red, and the neutral series
 * gr8r's accent → teal → violet run.
 */

export const AXIS_TICK = {
  fontSize: 12,
  fill: "var(--g8-text-3)",
} as const;

export const TOOLTIP_CURSOR = { stroke: "var(--g8-border-strong)" } as const;

export const TOOLTIP_CONTENT_STYLE = {
  borderRadius: "var(--g8-r)",
  border: "none",
  boxShadow: "var(--g8-shadow-pop)",
  background: "var(--g8-surface)",
  color: "var(--g8-text)",
  fontSize: "0.75rem",
} as const;

export const TOOLTIP_LABEL_STYLE = {
  color: "var(--g8-text-3)",
} as const;

export const COLOR = {
  done: "var(--g8-green)",
  warning: "var(--g8-amber)",
  danger: "var(--g8-red)",
  series1: "var(--g8-accent)",
  series2: "var(--g8-teal)",
  series3: "var(--g8-violet)",
  muted: "var(--g8-text-3)",
  grid: "var(--g8-divider)",
  bar: "var(--g8-surface-3)",
} as const;
