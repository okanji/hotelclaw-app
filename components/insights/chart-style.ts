/**
 * Shared recharts styling for the Insights section — the same editorial,
 * token-driven treatment as `property-pulse-widget.tsx`: CSS-variable colors
 * (dark-mode follows for free), hairline cursors, popover-styled tooltips,
 * tiny muted axis ticks. Series stay in the grayscale `--chart-*` ramp;
 * color is reserved for state — emerald = done/healthy, amber = warning,
 * rose = blocked/failed.
 */

export const AXIS_TICK = {
  fontSize: 10,
  fill: "var(--color-muted-foreground)",
} as const;

export const TOOLTIP_CURSOR = { stroke: "var(--color-border)" } as const;

export const TOOLTIP_CONTENT_STYLE = {
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-popover)",
  fontSize: "0.75rem",
} as const;

export const TOOLTIP_LABEL_STYLE = {
  color: "var(--color-muted-foreground)",
} as const;

export const COLOR = {
  done: "var(--color-emerald-500)",
  warning: "var(--color-amber-500)",
  danger: "var(--color-rose-500)",
  series1: "var(--chart-1)",
  series2: "var(--chart-2)",
  series3: "var(--chart-3)",
  muted: "var(--color-muted-foreground)",
} as const;
