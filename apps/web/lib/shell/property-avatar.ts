/**
 * Shared property "logo" rendering — a colored initial tile derived from the
 * property name + id. Used by the sidebar switcher list and the rail's org
 * mark so the same property reads with the same color everywhere. (Properties
 * have no uploaded-logo column yet; this is the generated stand-in.)
 */

export function propertyInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// Deterministic per-property tint so each property reads as distinct.
const TILE_TINTS = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
];

export function propertyTileTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TILE_TINTS[h % TILE_TINTS.length];
}
