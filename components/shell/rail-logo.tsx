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
