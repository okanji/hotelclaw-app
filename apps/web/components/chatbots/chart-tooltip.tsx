"use client";

/**
 * Dark pill tooltip for chatbot analytics charts (InsightCards reference
 * anatomy): the app's constant dark tooltip slab — `bg-tooltip-bg` +
 * `text-tooltip-foreground`, same on both planes — with a faint label line
 * and one colored-dot row per series. Pass to recharts via
 * `<Tooltip content={<ChartTooltipContent />} />`.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatLabel,
}: {
  active?: boolean;
  payload?: {
    name?: string | number;
    value?: string | number;
    color?: string;
    fill?: string;
  }[];
  label?: string | number;
  formatLabel?: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const heading =
    typeof label === "string" && formatLabel ? formatLabel(label) : label;
  return (
    <div className="rounded-md bg-tooltip-bg px-2.5 py-1.5 text-xs text-tooltip-foreground shadow-tooltip">
      {heading !== undefined && heading !== "" ? (
        <p className="mb-0.5 text-tooltip-foreground/70">{heading}</p>
      ) : null}
      {payload.map((row, i) => (
        <p key={i} className="flex items-center gap-1.5 tabular-nums">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: row.color ?? row.fill }}
          />
          <span className="font-medium">{row.value}</span>
          {row.name ? <span className="text-tooltip-foreground/70">{row.name}</span> : null}
        </p>
      ))}
    </div>
  );
}
