"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The house "AI is working" loader: a 3×3 pixel grid with a chevron
 * wavefront, a shimmering label, and a live elapsed timer in mono tabular
 * figures. One visual for every bot surface — channel bot, assistant, agent
 * chat, panel bots — so long-running AI work always reads the same way.
 *
 * Adapted from Beautiful UI's Loading State (beautifului.dev,
 * © 2026 Shane Levine, MIT). Keyframes + reduced-motion handling live in
 * app/globals.css under "AI activity primitives".
 */

/* Chevron wavefront: each cell's delay is its distance along a ">" front. */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return (col + Math.abs(row - 1)) * 90;
});

export function AiPixelGrid({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]",
        className,
      )}
    >
      {CHEVRON_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="ai-pixel-cell size-[4px] rounded-[1px] bg-foreground opacity-15"
          style={{ "--ai-pixel-delay": `${delay}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}

export function AiShimmerLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("ai-shimmer-label text-sm font-medium", className)}>
      {children}
    </span>
  );
}

/** Elapsed since mount — "3.2s", then "1m 12s". */
export function useAiElapsed(): string {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTenths((t) => t + 1), 100);
    return () => clearInterval(timer);
  }, []);
  const total = tenths / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${Math.floor(total % 60)}s`;
}

export function AiElapsed({ className }: { className?: string }) {
  const elapsed = useAiElapsed();
  return (
    <span
      className={cn(
        "font-mono text-xs text-faint-foreground tabular-nums",
        className,
      )}
    >
      {elapsed}
    </span>
  );
}

export function AiLoader({
  label = "Working…",
  showElapsed = true,
  className,
}: {
  label?: string;
  /** The timer starts when the loader mounts — turn on for real turns,
   *  off for indeterminate waits like "loading this conversation". */
  showElapsed?: boolean;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex w-fit items-center gap-2.5", className)}>
      <AiPixelGrid />
      <AiShimmerLabel>{label}</AiShimmerLabel>
      {showElapsed ? <AiElapsed /> : null}
    </div>
  );
}
