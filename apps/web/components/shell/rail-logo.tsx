/**
 * Brand mark — the "claw rake": three rounded, raking strokes that read as a
 * claw scratch from afar and as stacked chat-message lines up close. Left-
 * aligned and decreasing in length, tilted so the rake sweeps forward.
 *
 * Drawn in `currentColor` so the parent picks the tone: on the aubergine rail
 * tile it's white in light mode and white-on-transparent in dark mode. Scales
 * cleanly down to the 12px property-switcher use. Size comes from `className`
 * (defaults to 28×28).
 */
export function RailLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className ?? "size-7"}
    >
      <g fill="currentColor" transform="rotate(-10 16 16)">
        <rect x="5" y="8" width="22" height="4" rx="2" />
        <rect x="5" y="14" width="17" height="4" rx="2" />
        <rect x="5" y="20" width="12" height="4" rx="2" />
      </g>
    </svg>
  );
}

/**
 * The full app icon — a byte-for-byte match of `app/icon.svg` (the favicon):
 * an aubergine→pink gradient rounded tile with the white claw-rake. Unlike
 * {@link RailLogo} (a bare `currentColor` glyph), this is self-contained — it
 * carries its own gradient fill and tile, so it needs no colored wrapper.
 * Used as the brand mark at the top of the rail. Size comes from `className`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className ?? "size-8"}
    >
      <defs>
        <linearGradient
          id="brandmark-hc"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4a154b" />
          <stop offset="1" stopColor="#c0317e" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#brandmark-hc)" />
      <g fill="#ffffff" transform="rotate(-10 16 16)">
        <rect x="8" y="10" width="14" height="2.6" rx="1.3" />
        <rect x="8" y="14.7" width="11" height="2.6" rx="1.3" />
        <rect x="8" y="19.4" width="8" height="2.6" rx="1.3" />
      </g>
    </svg>
  );
}
