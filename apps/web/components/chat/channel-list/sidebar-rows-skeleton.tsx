"use client";

/**
 * Skeleton that mirrors `ChannelPreviewRow` — a gr8r `.sitem` row with a
 * small leading glyph + one label, drawn in gr8r's `.sk` shimmer — so the
 * loading state shape matches the loaded state. Stream's default
 * LoadingIndicator (the big-card LoadingChannels) doesn't fit the sidebar.
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
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="sitem"
          style={{ opacity: Math.max(0.35, 1 - i * 0.18), pointerEvents: "none" }}
        >
          <span
            className="sk"
            style={{
              width: withAvatar ? 20 : 15,
              height: withAvatar ? 20 : 15,
              borderRadius: withAvatar ? "50%" : 4,
              flexShrink: 0,
            }}
          />
          <span className="sk" style={{ height: 10, width: widths[i % widths.length] }} />
        </div>
      ))}
    </div>
  );
}
