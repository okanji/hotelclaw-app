/**
 * Brand mark pinned to the top of the dark icon rail. Ported 1:1 from the
 * rail prototype — four white tiles forming an offset glyph. Rendered white
 * because the rail is always dark (`bg-[#090909]`), independent of theme.
 */
export function RailLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M20.6667 29.3333H29.3333V20.6667H20.6667V29.3333Z" fill="white" />
      <path
        d="M20.6667 3.33333L12 12H20.6667V20.6667L29.3333 12V3.33333H20.6667Z"
        fill="white"
      />
      <path
        d="M12 29.3333L20.6667 20.6667H12V12L3.33334 20.6667V29.3333H12Z"
        fill="white"
      />
      <path d="M3.33334 12H12V3.33333H3.33334V12Z" fill="white" />
    </svg>
  );
}
