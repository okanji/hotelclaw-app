"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton that mirrors `ChannelPreviewRow` — small leading icon + a single
 * text label — so the loading state shape matches the loaded state. Stream's
 * default LoadingIndicator (the big-card LoadingChannels) doesn't fit the
 * sidebar row layout at all.
 */
export function SidebarRowsSkeleton({
  count = 4,
  withAvatar = false,
}: {
  count?: number;
  /** DM rows render a small avatar instead of a hash icon. */
  withAvatar?: boolean;
}) {
  // Pseudo-random widths so the rows look organic instead of identical.
  const widths = ["70%", "55%", "82%", "48%", "65%", "75%"];

  return (
    <ul aria-busy="true" aria-live="polite" className="space-y-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex h-8 items-center gap-2.5 px-2"
          style={{ opacity: Math.max(0.35, 1 - i * 0.18) }}
        >
          <Skeleton
            className={
              withAvatar
                ? "size-[18px] shrink-0 rounded-full"
                : "size-[18px] shrink-0 rounded-sm"
            }
          />
          <Skeleton
            className="h-3"
            style={{ width: widths[i % widths.length] }}
          />
        </li>
      ))}
    </ul>
  );
}
