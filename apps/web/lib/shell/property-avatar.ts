/**
 * Shared property "logo" rendering — a colored initial tile derived from the
 * property name + id. Used by the sidebar switcher list and the rail's org
 * mark so the same property reads with the same color everywhere. (Properties
 * have no uploaded-logo column yet; this is the generated stand-in.)
 */

export function propertyInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// Deterministic per-property tint so each property reads as distinct. These
// are IDENTITY colours, not state — so they spend the ENTITY pill family
// (globals.css `--pill-<hue>` / `--pill-<hue>-ink`), which is already the
// "hue @ 16% fill + same hue darkened for ink" recipe this tile wants and is
// already theme-aware (no `dark:` variant needed — the token flips itself).
const TILE_TINTS = [
  "bg-pill-rose text-pill-rose-ink",
  "bg-pill-amber text-pill-amber-ink",
  "bg-pill-green text-pill-green-ink",
  "bg-pill-blue text-pill-blue-ink",
  "bg-pill-violet text-pill-violet-ink",
  "bg-pill-slate text-pill-slate-ink",
];

// Same six hues, dialled down for a WIDE surface. The 16% chip fill is sized
// for a 20px tile; across a full-width row it reads as a coloured button, so
// the fill drops to ~9% (16% × 55) and only the ink carries the hue. Index
// stays keyed off the same string, so the switcher row and the rail's org
// tile are always the same colour for a given property.
const SOFT_TINTS = [
  "bg-pill-rose/55 text-pill-rose-ink hover:bg-pill-rose/80 data-open:hover:bg-pill-rose/80 active:bg-pill-rose/95",
  "bg-pill-amber/55 text-pill-amber-ink hover:bg-pill-amber/80 data-open:hover:bg-pill-amber/80 active:bg-pill-amber/95",
  "bg-pill-green/55 text-pill-green-ink hover:bg-pill-green/80 data-open:hover:bg-pill-green/80 active:bg-pill-green/95",
  "bg-pill-blue/55 text-pill-blue-ink hover:bg-pill-blue/80 data-open:hover:bg-pill-blue/80 active:bg-pill-blue/95",
  "bg-pill-violet/55 text-pill-violet-ink hover:bg-pill-violet/80 data-open:hover:bg-pill-violet/80 active:bg-pill-violet/95",
  "bg-pill-slate/55 text-pill-slate-ink hover:bg-pill-slate/80 data-open:hover:bg-pill-slate/80 active:bg-pill-slate/95",
];

function tintIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % TILE_TINTS.length;
}

export function propertyTileTint(key: string): string {
  return TILE_TINTS[tintIndex(key)];
}

/** Wide-surface variant of {@link propertyTileTint} — same hue, softer fill. */
export function propertySoftTint(key: string): string {
  return SOFT_TINTS[tintIndex(key)];
}
