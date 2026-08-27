---
name: beautiful-ui-style
description: 'The Beautiful UI (beautifului.dev) craft grammar, measured from its 20 component sources, mapped onto hotelclaw tokens. Load before building or polishing any staff-app card, row, list, trace, or status surface — it is the house recipe for making a component feel crafted instead of assembled.'
---

# Beautiful UI style — the measured craft grammar

Beautiful UI (beautifului.dev, © 2026 Shane Levine, MIT) is a set of 20
AI-native components whose quality comes from a small, rigid grammar rather
than from any individual flourish. All 20 raw sources are vendored at
`.references/beautiful-ui/` (never import from there — they use their own
tokens and demo data; port patterns, not code). This skill is that grammar,
**measured from the sources** (counts below are real), plus the exact
mapping onto this repo's token layer.

**Precedence:** `apps/web/DESIGN.md` (Notion-quiet, notion-spec-v2) always
wins where they conflict. The conflicts are enumerated in §6 — everything
else composes cleanly.

## 1. The seven habits (what actually makes it look good)

1. **Ink ramp discipline.** Three inks, used asymmetrically: full ink ONLY
   on the one thing being read (110 uses), secondary ink for body/values
   (71), faint ink for meta/labels/icons (83). If everything is full ink,
   nothing is.
2. **One easing, everywhere.** `cubic-bezier(0.23,1,0.32,1)` — a fast-out
   settle — appears 56×; the only other easing (`0.16,1,0.3,1`) is for
   larger moves. Durations cluster at 150–220ms (state changes), 300ms
   (expand/rotate), 400–450ms (entrances). Nothing is slower than 500ms
   except deliberate loops.
3. **Entrances are choreographed, then everything settles.** Lists and
   card groups enter with `fade-up` staggered **70–100ms per item**, `both`
   fill so items are invisible before their turn. Secondary elements (chips,
   badges) arrive on a **second beat** (~700ms later, scale 0.95→1, opacity,
   staggered 80ms). Every animation **runs once and settles** — components
   never loop, and autoplay always yields permanently to user interaction.
4. **Expansion is a grid, not a height hack.** Every collapse/expand (7 of
   20 components) is `display:grid; grid-template-rows: 0fr↔1fr` + opacity,
   300–400ms, with an inner `overflow-hidden` div. Chevrons rotate 180°
   over 300ms in sync. Expanded children get their own mini fade-up stagger.
5. **The detail rail.** Disclosed detail is indented behind a **1px
   vertical hairline** (`grid-cols-[24px_1fr]` with a `w-px` line, or
   `ml-[7px] border-l pl-4`) — the signature "this belongs to that" move,
   used by the thinking trace, task rows, and step details.
6. **Numbers are typographic objects.** `tabular-nums` on every count,
   time, and metric (12 of 20 components); mono for ids, code, and
   file names. Counts get a **count badge**: `h-5 rounded-md px-1.5
   text-[11.5px] font-medium` on an inset fill with a hairline ring.
7. **Controls earn their pixels.** Row actions are hidden until hover
   (`opacity-0 group-hover:opacity-100`, or rest at ~50% where touch
   matters), hit targets are round (`size-7 rounded-full`) around small
   glyphs, and icons are tiny inline SVGs — **9–15px, strokeWidth 2.2–2.5,
   currentColor** — never 20px icon-font dumps.

## 2. Anatomy recipes (portable as-is)

### Card (from ContextCards / TaskRows)
```
<article rounded-card bg-<surface> shadow-card overflow-hidden + fade-up entrance>
  <header  h-7..8 px-2.5 flex items-center gap-1.5 border-b border-<line>>
    tiny icon (11px, sw 2.5, faint) · 13px-medium title truncate ·
    ml-auto meta (12px faint tabular-nums)
  <body    px-3 py-2  12.5px leading-relaxed secondary-ink, line-clamped>
  <footer  px-3 pb-3  chips: h-6 rounded-full inset-fill shadow-btn 12px-medium,
           entering on the second beat>
```
Hover = a fill change (`hover:bg-<inset>`), never a border or lift.

### Row (from TaskRows / ThinkingState)
```
<button h-11 w-full px-2.5 flex items-center gap-2.5 text-left>
  size-6 status glyph (ring/check/x) · 13px-medium title truncate flex-1 ·
  12.5px tabular meta · status pill · chevron in size-7 rounded-full hover target
</button>
<grid-rows disclosure>
  detail rail (24px gutter + w-px hairline) → 12.5px label / 11.5px meta rows,
  each fade-up staggered ~90ms
```
In a list shell, rows divide with `border-b last:border-0` inside one
rounded card; standalone rows carry their own card chrome — and **radius
can animate** (TaskRows: 22px closed → 14px open, in the same transition).

### Status pill
`h-5.5 rounded-full px-2 text-[11.5px] font-medium`, hue **tint** fill +
same-hue ink (`bg-green-tint text-green`). State changes swap pills with a
200ms fade-in — status never just snaps.

### Loading / working
Never a bare spinner: the pixel-grid wavefront + shimmer label + mono
elapsed timer. Already housed as `components/ui/ai-loader.tsx`
(`AiLoader` / `AiPixelGrid` / `AiShimmerLabel` / `AiElapsed`).

## 3. The numbers (theirs → ours)

| Role | BUI measured | hotelclaw (DESIGN.md wins) |
|---|---|---|
| Card/row title | 13px medium | `text-sm font-medium` (14px) — gallery-card titles that ARE content: `text-base` 16px/24 w400 |
| Body / secondary | 12.5px | `text-sm` secondary ink |
| Meta / labels | 12px | `text-xs` (12px floor — never 11.5/11px) |
| Pills / chips / badges | 11.5px | `text-xs` |
| Row height | h-11 (44px) | h-11 for interactive rows; 37px table rows stay 37px |
| Chip | h-6 rounded-full | same, `bg-muted` + `shadow-ring` |
| Count badge | h-5 rounded-md bg-inset shadow-hairline | `h-5 rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground shadow-ring tabular-nums` |
| Entrance | fade-up 400–450ms, stagger 70–100ms | `.ai-fade-up` (globals.css) + `animationDelay: min(i, 6..8)×70–90ms` |
| Expand | grid-rows 0fr↔1fr, 300ms | same, inline style |
| Easing | cubic-bezier(0.23,1,0.32,1) | same (already in `.ai-fade-up`) |

## 4. Token map (never use theirs)

| BUI | hotelclaw |
|---|---|
| `--ink` / `text-ink` | `text-foreground` |
| `--ink-2` | `text-secondary-ink` (nav/labels) or `text-muted-foreground` (body) |
| `--ink-3` | `text-faint-foreground` |
| `bg-surface` | `bg-card` (on the page) / `bg-background` (inside a muted well) |
| `bg-inset` | `bg-muted` |
| `bg-hover` / `bg-hover-2` | `hover:bg-accent` |
| `border-line` / `bg-line` | `border-border` / `bg-border` |
| `shadow-hairline` | `shadow-ring` |
| `shadow-card` / `shadow-overlay` | same names exist — use them |
| `shadow-btn` | `shadow-ring` |
| green / red / orange (+`-tint`) | `success` / `destructive` / `warning` (+ `/10`–`/15` fills or `pill-*`/`StatusBadge` tokens) |
| `--accent` (their purple) | **never map to primary-blue for decoration** — use context: `info`, chart tokens, or the house tint palette |
| `rounded-card` (their 14–22px) | house `rounded-card` (10px) — five-radii rule wins |
| `--tooltip-bg/-fg` | `bg-tooltip-bg text-tooltip-foreground shadow-tooltip` |

Shared primitives already ported (reuse, don't rebuild): `ui/ai-loader`,
`ai/tool-trace`, `ai/recommendation-card`, `ai/selection-actions-bar`,
`ui/scrub-field`, `workflows/run-status-ring`; keyframes `ai-pixel-on`,
`ai-shimmer`, `ai-fade-up`, `ai-blur-in` in `app/globals.css`.

## 5. Motion checklist (apply to any new/touched surface)

- [ ] List/grid items enter with `.ai-fade-up` + capped stagger (`Math.min(i, N)*delay`)
- [ ] Second-beat reveal for decorative chips/badges where they exist
- [ ] Any expand/collapse uses the grid-rows pattern + synced chevron
- [ ] Status changes fade in (200ms), never snap
- [ ] Hover states are fill changes; row actions hover-revealed with a focus-visible fallback
- [ ] Every number is `tabular-nums`; counts use the count-badge recipe
- [ ] Nothing loops; reduced-motion is covered (the shared classes already handle it — inline `style.animation` must add `motion-reduce` handling or use the classes)

## 6. Where DESIGN.md overrides BUI — do NOT copy these

1. **Type floor is 12px** — BUI's 11.5/11/10.5px rungs are banned; collapse
   them all to `text-xs`.
2. **Five radii with fixed jobs** — BUI's fluid 5/6/8/10/14/22px scale
   collapses to the house 4/6/10/20/full. Radius *animation* is allowed
   between two house rungs only.
3. **Primary blue is for primary actions** — BUI's purple accent decorates
   freely; here decoration comes from the tint palette / semantic ramp.
4. **Sentence case, never tracked uppercase.**
5. **Guest world (`/g`, `/book`, onboarding) is out of scope** — it has its
   own cream/serif language; only the *motion* grammar (blur-in, staggers)
   ports there.
