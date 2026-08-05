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

export function propertyTileTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TILE_TINTS[h % TILE_TINTS.length];
}
