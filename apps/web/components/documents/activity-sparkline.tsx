"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

type ActivitySparklineProps = {
  values: number[];
  className?: string;
  /** Emphasize the latest bucket — used for live activity. */
  pulseLast?: boolean;
  /** Compact sparkline for list rows. */
  size?: "sm" | "md" | "lg";
};

const SIZES = {
  sm: { width: 56, height: 20 },
  md: { width: 72, height: 28 },
  lg: { width: 100, height: 36 },
} as const;

/**
 * Lightweight SVG sparkline — no chart library, theme-aware via currentColor.
 */
export function ActivitySparkline({
  values,
  className,
  pulseLast = false,
  size = "sm",
}: ActivitySparklineProps) {
  const gradientId = useId();
  const { width, height } = SIZES[size];
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const coords = values.map((value, index) => ({
    x: index * step,
    y: height - (value / max) * (height - 2) - 1,
  }));

  const linePoints = coords.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPoints = [
    `0,${height}`,
    ...coords.map(({ x, y }) => `${x},${y}`),
    `${width},${height}`,
  ].join(" ");

  const last = coords[coords.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("block shrink-0 text-muted-foreground", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={areaPoints}
        fill={`url(#${gradientId})`}
        className="transition-all duration-500"
      />
      <polyline
        points={linePoints}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="transition-all duration-500"
      />
      {pulseLast && last && values[values.length - 1] > 0 ? (
        <circle
          cx={last.x}
          cy={last.y}
          r="2.5"
          fill="currentColor"
          className="animate-pulse"
        />
      ) : null}
    </svg>
  );
}
