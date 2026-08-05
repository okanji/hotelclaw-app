import type { EntityColor } from "@/lib/db/types";

export const LABEL_COLORS: EntityColor[] = [
  "slate",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
];

/**
 * The solid dot / swatch for an entity colour (label dots, project dots, team
 * dots, the colour picker's swatches).
 *
 * This is the pill INK rung, not the pill FILL: a 16%-alpha fill would
 * disappear at 6–12px. Ink and fill are the same hue, so a dot beside its own
 * chip reads as one object (notion-spec-v2 §6).
 *
 * These used to be raw tailwind palette shades (`bg-blue-500`,
 * `bg-emerald-500`…). That ramp is COLD and visibly wrong against the warm
 * planes — the whole reason the `--pill-*` entity family exists.
 */
export const LABEL_DOT: Record<EntityColor, string> = {
  slate: "bg-pill-slate-ink",
  blue: "bg-pill-blue-ink",
  green: "bg-pill-green-ink",
  amber: "bg-pill-amber-ink",
  rose: "bg-pill-rose-ink",
  violet: "bg-pill-violet-ink",
};

/**
 * Entity chips (labels, projects, teams) are the ONE place the app spends a
 * saturated hue — they are user-chosen identity, not chrome. Notion's own tag
 * chips are the same shape: a soft ~16% wash with darkened same-hue ink, no
 * stroke, on the 4px pill rung.
 *
 * `EntityColor` is the sanctioned palette (DESIGN.md § Entity colors) and the
 * `--pill-<hue>` / `--pill-<hue>-ink` token pairs are its ONE rendering. They
 * are deliberately a separate family from the semantic pills (`pill-success`
 * etc.): a user picking "green" is choosing an identity, not asserting a
 * lifecycle state. Never re-derive a chip colour from the tailwind palette.
 */
export const LABEL_CHIP: Record<EntityColor, string> = {
  slate: "bg-pill-slate text-pill-slate-ink",
  blue: "bg-pill-blue text-pill-blue-ink",
  green: "bg-pill-green text-pill-green-ink",
  amber: "bg-pill-amber text-pill-amber-ink",
  rose: "bg-pill-rose text-pill-rose-ink",
  violet: "bg-pill-violet text-pill-violet-ink",
};

/**
 * The INK rung on its own — for a glyph tinted by entity colour where the
 * shape IS the mark (a lucide icon drawn in `currentColor`), so there is no
 * chip fill behind it. Same hue as `LABEL_DOT`/`LABEL_CHIP`.
 *
 * This exists so the sidebar, the project/team picker and the board strip
 * stop each keeping their own private `{slate:"text-slate-500", …}` literal —
 * three copies of the same cold tailwind ramp is exactly the drift DESIGN.md's
 * "single-source color maps" rule is about.
 */
export const LABEL_INK: Record<EntityColor, string> = {
  slate: "text-pill-slate-ink",
  blue: "text-pill-blue-ink",
  green: "text-pill-green-ink",
  amber: "text-pill-amber-ink",
  rose: "text-pill-rose-ink",
  violet: "text-pill-violet-ink",
};

/**
 * A WASH — the chip fill at half strength, for a surface tinted by entity
 * colour rather than a chip (a drop-zone under a drag, a soft row band).
 * Half of the pill's 16% lands at ~8%, which is where these hand-rolled
 * `bg-<hue>-500/8` literals used to sit.
 */
export const LABEL_WASH: Record<EntityColor, string> = {
  slate: "bg-pill-slate/50",
  blue: "bg-pill-blue/50",
  green: "bg-pill-green/50",
  amber: "bg-pill-amber/50",
  rose: "bg-pill-rose/50",
  violet: "bg-pill-violet/50",
};
