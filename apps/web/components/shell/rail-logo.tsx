/**
 * Brand mark — the "claw rake": three rounded, raking strokes that read as a
 * claw scratch from afar and as stacked chat-message lines up close. Left-
 * aligned and decreasing in length, tilted so the rake sweeps forward.
 *
 * Drawn in `currentColor` so the parent picks the tone from the ink token it
 * already sits in. Inside the icon rail that's the rail's own scoped `dark`
 * subtree (`--sidebar` pinned to `--rail`, the warm near-black `#211f1b`), so
 * it inherits `text-sidebar-foreground` / `text-sidebar-accent-foreground`
 * like every other glyph on that plane — no bespoke white. Scales cleanly
 * down to the 12px property-switcher use. Size comes from `className`
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
 * The full app icon — the brand tile: a diagonal `--brand` → `--brand-accent`
 * wash (aubergine → lavender, the documented Slack-heritage brand pair) with
 * the white claw-rake on top. Unlike {@link RailLogo} (a bare `currentColor`
 * glyph), this is self-contained — it carries its own fill and tile, so it
 * needs no colored wrapper. Size comes from `className`.
 *
 * Three deliberate choices:
 *  - **Tokens, not hexes.** The stops are `var(--brand)` / `var(--brand-accent)`
 *    through `style` (a `var()` in a bare SVG presentation attribute is not
 *    reliably resolved; the CSS property is). The old aubergine→magenta pair
 *    had no token and could not stay (DESIGN.md house rules).
 *  - **`rx="6"`** — the 6px clickable rung at the mark's natural 32px size,
 *    the same radius as the rail's own icon tiles (notion-spec §4). It was 7.
 *  - **A mid-lightness tile.** The wash runs dark→light across the diagonal,
 *    so the mark holds an edge on the near-white chrome plane AND on the
 *    rail's warm near-black (`--rail: #211f1b`), where a flat aubergine tile
 *    would have sunk into the surface.
 *
 * It is therefore no longer byte-identical to `app/icon.svg`; the favicon
 * keeps its own colors and is not a shell surface.
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
          <stop style={{ stopColor: "var(--brand)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-accent)" }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill="url(#brandmark-hc)" />
      <g className="fill-white" transform="rotate(-10 16 16)">
        <rect x="8" y="10" width="14" height="2.6" rx="1.3" />
        <rect x="8" y="14.7" width="11" height="2.6" rx="1.3" />
        <rect x="8" y="19.4" width="8" height="2.6" rx="1.3" />
      </g>
    </svg>
  );
}
