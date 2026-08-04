# Hotelclaw design system

Two visual worlds, one token source. Read this before building any UI.

The app shell follows **`docs/notion-spec.md`** — measured values pulled off
`app.notion.com` with `getComputedStyle`, not guesses. **When this file and
the spec disagree, the spec wins.** Every number below traces back to it.

> **This replaced the old Linear-inspired system (2026-08-04).** If you
> remember rules about uppercase tracked eyebrows, a seven-rung radius scale,
> `border-border` on every card, `shadow-sm` on resting surfaces, or a global
> `-0.011em` letter-spacing — those are all **reversed**. See "What changed"
> at the bottom.

## The two worlds

| | **App shell** | **Guest world** |
|---|---|---|
| Who | Staff, managers, owners | Hotel guests + first-run owners |
| Where | Everything under `/p/[propertyId]` | Onboarding wizard, `/welcome`, `/book`, `/g/[botSlug]`, event pages, booking emails |
| Look | Notion-quiet: warm near-white chrome, white content, almost no strokes, 6px/10px radii, sentence-case labels | Warm cream, serif display questions, rust accent, one decision per screen |
| Theming | Light + dark (`.dark` class) | **Never theme-switches** — always cream |
| Tokens | `background/card/muted/border/accent…` | `guest-*` |

**The guest world is out of scope for the Notion normalization** and must not
change. It is a deliberate, distinct world. See its section below.

---

## The five mechanisms

Notion is not "minimal", it is **quiet**. Five things do the work. If a
surface looks like a stock component library, it's violating one of these:

1. **Almost no borders.** Surfaces separate by a **~2% fill delta** plus a
   *sub-hairline* **7% warm ring** — never a visible gray stroke.
2. **Everything is warm-tinted.** Hover is `rgba(33,27,23,0.05)`, rings are
   `rgba(42,28,0,0.07)` — brown-black, never `#000` and never cold gray.
3. **Muted by default.** Sidebar/nav rows are secondary ink at weight 500.
   Only the thing you're reading gets full ink.
4. **One rhythm.** Rows are 30px. Menu items 28px. Radii 6px / 10px. Icons
   12–16px. Everywhere.
5. **Sentence case, letter-spacing `normal`.** Section labels are 12px/12px
   weight 500 faint — **not** uppercase, **not** tracked.

---

## Tokens (`app/globals.css`)

All colors are CSS variables mapped through `@theme inline` — use utilities,
never raw hex in components.

### Planes

|  | Light | Dark |
|---|---|---|
| Content canvas — `bg-card` / `bg-popover` | `#ffffff` | `#191919` |
| Chrome — `bg-background`, `bg-sidebar` | `#f9f8f7` | `#202020` |

Note the inversion: in **dark, chrome is LIGHTER than content**. That is
measured, and getting it backwards is what made the old dark shell read muddy.
Both planes stay in the same warm hue family — a theme switch must never shift
temperature.

`--rail` is the icon rail's warm near-black chrome, the one deliberately dark
surface in both themes.

### Ink ramp — four rungs, use the right one

| Token / utility | Light | Use for |
|---|---|---|
| `text-foreground` | `#2c2c2b` | body, titles, the active row |
| `text-secondary-ink` | `#5f5e59` | sidebar + nav row labels (14px/500) |
| `text-muted-foreground` | `#7d7a75` | inline hints, secondary body |
| `text-faint-foreground` | `#a19e99` | **section labels, captions, shortcut hints** |

`text-faint-foreground` is new. Labels and captions used to reuse
`--muted-foreground`; they now have their own lighter rung so a caption never
reads as body text. If you're styling a 12px label, it is faint.

### Fills, rings, focus

- **`bg-accent`** — the hover fill, `rgba(33,27,23,0.05)` light /
  `rgba(255,255,255,0.055)` dark. One value for the app AND the sidebar; the
  same gesture must not have two alphas.
- **`bg-accent-pressed`** — pressed/selected rung, 8% / 9%.
- **`text-accent-foreground`** is deliberately equal to `text-foreground`, so
  `hover:text-accent-foreground` is a **no-op**. Hover never flips the label.
- **`bg-muted`** — the translucent warm well (4%). Being translucent it
  composites correctly on both the white content plane and the chrome plane.
  Don't stack `/50` or `/30` modifiers on it — it is already faint.
- **`border-border` / `--border`** — `rgba(42,28,0,0.07)`, the signature warm
  ring. It is the divider, the input edge, the card boundary. It is *not* a
  gray stroke; if you can clearly see it as a line, something is wrong.
- **`--ring` = `#2383e2`** (Notion blue) and focus is spent as
  `focus-visible:shadow-focus` → `1px inset + 1px outer`. **Not** a 3px offset
  halo. Never `focus-visible:ring-[3px] ring-ring/50` again.

### Radius — exactly two rungs

```
6px   var(--radius)          anything you CLICK: buttons, inputs, rows, menu
                             items, cards, chips, badges, wells, tiles
10px  var(--radius-overlay)  anything that FLOATS: popover, dropdown, dialog,
                             sheet, command palette, toast, drag overlay
```

`rounded-sm`, `rounded-md`, `rounded-lg` and `rounded-4xl` **all collapse onto
6px** — existing call sites land on the scale with no edits. Floating surfaces
use `rounded-overlay`. `rounded-full` still means avatars, dots and progress
tracks, nothing else.

`rounded-xl` / `2xl` / `3xl` are **frozen legacy rungs that exist only for the
guest world**. App surfaces must never use them. If you find one in an app
file, convert it to `rounded-md` (clickable) or `rounded-overlay` (floating).

### Elevation — overlays only

There is **one** recipe and it lives in a token:

- **`shadow-overlay`** — the full three-layer elevation with the **1px warm
  ring as the last layer**. Every popover / dropdown / dialog / sheet /
  command palette / toast / drag overlay gets `rounded-overlay shadow-overlay`
  and **`border: none`, no `ring-*` utility** — stacking a ring on top
  double-rings it.
- **`shadow-tooltip`** — the tighter tooltip recipe. Tooltips are a constant
  dark slab (`bg-tooltip-bg text-tooltip-foreground`) on **both** planes —
  never `bg-foreground`, which inverts with the theme.
- **`shadow-ring`** — a bare 1px warm ring for a resting surface that
  genuinely needs a boundary. **This replaces `border border-border` on
  cards.** Prefer no boundary at all: fill delta first, ring only if the card
  genuinely floats free of a container.
- **`shadow-focus`** — the 1px inset+outer Notion blue focus shadow.
- **`--sidebar-edge-shadow`** — the sidebar's right edge is an inset shadow,
  not a border. Use `shadow-(--sidebar-edge-shadow)`.

**Resting cards get NO shadow.** `shadow-sm` / `shadow-xs` / `hover:shadow-*`
on a static card is a bug. Elevation means "this floats above the page".

### Motion

`--default-transition-duration` is **20ms** and the default easing is
`ease-in`, so a bare `transition-colors` is now near-instant everywhere with
no file edits. Never animate a hover color over 150ms — it feels laggy.
Transitions are for movement; hover is a fill change, not an animation.

### Semantic + brand tokens (retuned, not removed)

- **`--success` / `--warning` / `--info` / `--destructive`** — the ONE source
  for state colors (badges, dots, meters). Desaturated one rung so they read
  as warm accents on the quiet planes. Never re-pick emerald/amber/blue
  inline. Violet (occupied/in-progress) is the only state color used directly.
- **`--accent-red`** — the Claude coral, quieted. Hairline accent rules and
  small markers only. **It is no longer an eyebrow color** — labels are faint
  and uncolored — and it is never a button.
- **`--tint-{lavender,blue,sage,coral,honey}`** (+ `-ink`) via `TintCard` /
  `StatCard tone` — warm washes, chroma pulled back from the old pastels.
  Reserve for a few feature tiles per view. `--cover-ink` is the ink for text
  sitting on a tint cover.
- **`--notification`**, **`--brand`**, **`--brand-accent`**, **`--icon-accent`**
  — shell chrome marks; `--icon-accent` now sits in the same blue family as
  the focus ring.
- **`--chart-1…5`** and `--scrollbar-thumb` are warm-tinted (they were
  chroma-0 cold gray). `--chart-*` is a **monochrome value ramp** — use it
  when the bars mean *more/less*, not *which*.
- **`--series-1…8`** — the ONE **categorical** ramp: colour-by-series and
  colour-by-person (document chart blocks, spreadsheet charts, spreadsheet
  presence cursors). Consume as `var(--series-N)` from SVG/inline style.
  Before it existed each of those three surfaces hardcoded its own palette
  (tailwind-500 hexes / raw `hsl()`), which read cold against the warm
  planes. Never re-pick a categorical palette inline.
- **`--annotation-*` / `--diff-*`** — document comment marks and AI diff
  marks, previously hardcoded hexes in `app/documents-editor.css`.
- **`--shell-border`** is **deprecated** and has **zero call sites** as of
  2026-08-04: the shell's three planes sit flush and separate by fill delta
  plus the sidebar's inset edge shadow. Do not use it in new code.

### Fonts

`font-sans` (Inter Variable, OpenType-tuned), `font-mono` (Geist Mono),
`font-serif` (**guest world only** — the app shell has no serif voice).

There is **no global letter-spacing**. Do not reintroduce `tracking-tight`,
`tracking-wide`, `tracking-widest` or `tracking-[0.18em]` on app surfaces.

### Entity colors

`slate | blue | green | amber | rose | violet` (`EntityColor` in
`lib/db/types.ts`, `colorAt(i)` in `lib/onboarding/plan.ts`) for user-owned
things: spaces, labels, departments, boards.

---

## Type ramp

| Element | Size / line-height | Weight | Color |
|---|---|---|---|
| Page title | `40px / 48px` | **700** | foreground |
| Section title | `16px / 24px` | 600 | foreground |
| Body / block text | `16px / 24px` | 400 | foreground |
| **UI row label** (sidebar, nav, list rows) | `14px / 21px` | **500** | secondary-ink |
| Menu item label | `14px / 16.8px` | 400 | foreground |
| **Section label** | `12px / 12px` | **500** | faint — no uppercase, no tracking |
| Caption | `12px / 16px` | 500 | faint |
| Shortcut hint (`⌘K`) | `12px` | 400 | faint |
| Tooltip | `12px` | 400 | tooltip-foreground |

**14px is the UI default, not 12px.** Notion reserves 12px for
labels/captions/shortcuts. Our old habit of `text-xs` rows is why the app
reads cramped. Nothing goes below 12px — no `text-[10px]`, no `text-[0.625rem]`.

Headings are `font-semibold` (the 40px page title is the only `font-bold`).
`text-balance` on headings, `text-pretty` on paragraphs, `tabular-nums` on
numbers that change.

---

## Geometry

| Thing | Value |
|---|---|
| Sidebar width | `270px`, `8px` inner padding |
| Sidebar / list row | `30px` tall, `6px` radius, `1px` gap (31px pitch) |
| Row icon | `12–16px`, `8px` gap to label |
| Topbar | `44px` tall, **transparent** — no fill, no bottom border |
| Menu / dropdown item | `28px` tall, `6px` radius, `3px 6px` padding |
| Content column | `720px` max-width, centered |
| Divider | `1px` `--border`, full panel width |

---

## Interaction

- **Hover on any row/control: fill only.** `hover:bg-accent`. No border
  change, no shadow, no lift, no label color flip. Doing all four at once is
  the single most common violation in the old code.
- **Active nav row:** hover-fill at rest + full ink. There is **no** accent
  bar, no bold, no colored background.
- **Focus:** `focus-visible:shadow-focus`.
- Row affordances (`•••`, `+`) appear on hover only, right-aligned in the row.

---

## Primitives (`components/ui/`)

Beyond the shadcn set (button, card, badge, dialog, sidebar…), the house
primitives — **use these instead of hand-rolling**:

| Component | Use for | Never |
|---|---|---|
| `EmptyState` | every "nothing here yet" moment | a **dashed gray box**; a `size-12 rounded-full bg-muted` icon plate |
| `Eyebrow` (`tone="app" \| "brand" \| "guest"`) | the small section label above a heading or date group | uppercase, `tracking-*`, or a colored label on app surfaces |
| `SectionHeader` (`size="page" \| "section" \| "panel"`) | title + description + right-aligned actions | the ~70th inline `flex items-center justify-between` header; a serif page title |
| `StatGroup` + `Stat` | dashboard/agenda metric strips | stat *cards*; **vertical rules between columns**; icons inside stats |
| `StatusBadge` (`tone="neutral \| success \| warning \| info \| danger \| violet"`) | domain lifecycle states | picking badge colors per domain; a `border-<tone>/30` stroke |
| `Chip` (`tone="app" \| "guest"`, `selected`) | toggleable filter/option pills | bespoke `rounded-full border` toggles; hover that changes the border |
| `TintIcon` (`tone`, from `ui/tint-card`) | the tinted icon plate on a neutral card; tone by domain: tasks=blue · bookings=coral · calendar=sage · docs/AI=lavender · forms/reports=honey | hand-rolled `rounded-lg bg-*/10` plates |

`Eyebrow`'s `guest` tone keeps its uppercase + tracking — that is the guest
world's voice and it stays. Only the `app` / `brand` tones changed.

Domain status maps stay in the domain (`lib/bookings/status-colors.ts` is the
model: statuses → tones/classes in ONE file, every surface derives from it).

**Adding a fresh shadcn component:** it will scaffold with
`rounded-lg shadow-md ring-1 ring-foreground/10` on overlays and
`focus-visible:ring-[3px]` on controls. Rewrite those to
`rounded-overlay shadow-overlay` and `focus-visible:shadow-focus` before it
lands. (`components.json` uses `baseColor: "stone"` so new components at least
scaffold on a warm ramp.)

---

## Guest kit (`components/guest/ui.tsx`) — OUT OF SCOPE

**Unchanged.** The warm-cream serif world is deliberate and must not be
normalized. Do not touch `components/guest/**`,
`components/public-booking/**`, `components/guest-chat/**`, `app/g/**`,
`app/book/**`, `app/onboarding/**`, `app/welcome/**`, `lib/**/email*`, or any
`guest-*` token.

**Guest palette** — `bg-guest-bg`, `bg-guest-card`, `text-guest-ink`,
`text-guest-ink-soft` (body), `text-guest-ink-mid` (chip text),
`text-guest-ink-faint` (eyebrows, hints), `border-guest-line`,
`border-guest-line-strong` (hover), `bg-guest-line-soft` (tracks),
`bg-guest-accent` / `hover:bg-guest-accent-hover` / `text-guest-accent-ink`
(rust), `text-guest-danger`. If you find yourself typing `#c96442` or
`#faf9f5`, stop — the token exists.

For any guest-world surface: `GuestShell` (cream canvas), `GuestQuestion`
(serif display), `GuestHint`, `GuestPrimaryButton` (the ONE rust pill per
screen), `GuestGhostButton` (Back/Skip), `GuestBigInput` (serif underline),
`GuestInput`, `GuestError`. Combine with `<Chip tone="guest">` and
`<Eyebrow tone="guest">`. The onboarding wizard + `/welcome` are the reference
implementations.

The guest world consumes the shared `--radius-xl/2xl/3xl` rungs, which is why
those three are frozen rather than collapsed.

---

## House rules

- **Never hardcode a hex/rgb in a component.** If a color is missing, it
  becomes a token in `app/globals.css` and components use the utility.
- **One primary button per screen** (dialogs count as their own screen);
  everything else is ghost/outline/muted. Max two button sizes per view.
- **Separation ladder:** whitespace → 2% fill delta → warm ring
  (`shadow-ring`) → elevation (`shadow-overlay`, floating only). A visible
  gray stroke is not on the ladder.
- Dark mode = same contrast ratios, not inverted colors; borders/fills stay
  alpha-based so they work on both planes.
- Spacing between flex/grid children: `gap-*` on the parent, not margins.
- Icons: `size-4` default, `shrink-0` in flex rows; no icons in stats.
- `role="list"` on every `<ul>`/`<ol>` without `list-style`.

---

## What changed (2026-08-04) — reversed rules

If you learned the old system, unlearn these:

| Old rule | New rule |
|---|---|
| `Eyebrow` = "small **uppercase tracked** label", never re-type `tracking-[0.18em]` | Labels are **sentence case, 12px/12px, weight 500, faint, no tracking**. The uppercase tracked eyebrow was our single loudest "template" tell. |
| "Everything derives from `--radius` via the `--radius-sm…4xl` scale" | **Two rungs only**: 6px clickable, 10px floating. `sm/md/lg/4xl` all collapse to 6px; `xl/2xl/3xl` are frozen guest-only legacy. |
| Cards are `border border-border bg-card` | Cards separate by **fill delta**; a boundary, if truly needed, is `shadow-ring`. No stroke. |
| Separation: whitespace → hairline divider (`border-border/60`) → well (`bg-muted/50`) → card | Don't stack opacity modifiers on tokens that are already 4–7% alpha. Use them at full strength. |
| Global `letter-spacing: -0.011em` + `tracking-tight` above `text-xl` | Letter-spacing is `normal` **everywhere**. |
| `text-sm` body, `text-xs` for metadata | **14px is the UI default.** 12px is labels/captions/shortcuts only. Nothing below 12px. |
| `shadow-sm` on cards, `hover:shadow-sm`, `hover:-translate-y-0.5` | Elevation on **floating overlays only**. No lift, ever. |
| `focus-visible:ring-[3px] ring-ring/50` | `focus-visible:shadow-focus` — 1px inset + 1px outer, Notion blue. |
| `--shell-border` (deliberately darker shell outline) | Deprecated alias of `--border`. The shell is two flush planes. |
| Hover may change border + background + label color | **Fill only**, 20ms. |
