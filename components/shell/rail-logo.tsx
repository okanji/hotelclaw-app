/**
 * Brand mark pinned to the top of the icon rail — four tiles forming an offset
 * glyph. Drawn in `currentColor` so the parent picks the tone: on the new
 * aubergine rail it sits in a white tile tinted brand-purple; size comes from
 * the passed `className` (defaults to 28×28).
 */
export function RailLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className ?? "size-7"}
    >
      <path
        d="M20.6667 29.3333H29.3333V20.6667H20.6667V29.3333Z"
        fill="currentColor"
      />
      <path
        d="M20.6667 3.33333L12 12H20.6667V20.6667L29.3333 12V3.33333H20.6667Z"
        fill="currentColor"
      />
      <path
        d="M12 29.3333L20.6667 20.6667H12V12L3.33334 20.6667V29.3333H12Z"
        fill="currentColor"
      />
      <path d="M3.33334 12H12V3.33333H3.33334V12Z" fill="currentColor" />
    </svg>
  );
}
