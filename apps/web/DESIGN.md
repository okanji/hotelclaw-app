# Hotelclaw design system

Two visual worlds, one token source. Read this before building any UI.

The app shell follows **`docs/notion-spec-v2.md`** — measured values pulled off
`app.notion.com` with `getComputedStyle`, not guesses. **When this file and
the spec disagree, the spec wins.** Every number below traces back to it.

> ### v2 supersedes v1 (2026-08-05)
>
> `docs/notion-spec-v2.md` **supersedes `docs/notion-spec.md`** wherever they
> disagree. v1 fixed our *tokens*; v2 fixes the *structure* — the reason the
> app still read as a dashboard rather than as Notion. Three v1 rules are now
> **reversed**, and if you learned them, unlearn them:
>
> | v1 said | v2 says |
> |---|---|
> | "Two radii: 6px clickable, 10px floating" | **Five radii** — 4 / 6 / 10 / 20 / full, each with exactly one job. |
> | "Resting surfaces carry no shadow" | **Cards DO carry a soft shadow** (`shadow-card`). Still true for wells and list rows. |
> | "Primary buttons stay warm ink" | **Primary is Notion blue `#2383e2`** with a near-white label. |
>
> Plus two additions v1 had no opinion on: the **720px document column**
> (with data views breaking out of it to full width) and a **role-based type
> ramp** (content 16px · UI 14px · metadata 12px — v1 wrongly flattened
> content down to 14px).
>
> **And this whole system replaced the Linear-inspired one (2026-08-04).** If
> you remember rules about uppercase tracked eyebrows, a seven-rung radius
> scale, `border-border` on every card, `shadow-sm` on resting surfaces, or a
> global `-0.011em` letter-spacing — those are all reversed too. See "What
> changed" at the bottom.

## The two worlds

| | **App shell** | **Guest world** |
|---|---|---|
| Who | Staff, managers, owners | Hotel guests + first-run owners |
| Where | Everything under `/p/[propertyId]` | Onboarding wizard, `/welcome`, `/book`, `/g/[botSlug]`, event pages, booking emails |
| Look | Notion-quiet: warm near-white chrome, white content, almost no strokes, a 720px document column, five radii, sentence-case labels, system font | Warm cream, serif display questions, rust accent, one decision per screen |
| Theming | Light + dark (`.dark` class) | **Never theme-switches** — always cream |
| Tokens | `background/card/muted/border/accent…` | `guest-*` |

**The guest world is out of scope for the Notion normalization** and must not
change. It is a deliberate, distinct world. See its section below.

---

## The mechanisms

Notion is not "minimal", it is **quiet** — and it is a **document**. Seven
things do the work. If a surface looks like a stock component library or like
a dashboard, it's violating one of these:

1. **Almost no borders.** Surfaces separate by a **~2% fill delta** plus a
   *sub-hairline* **7% warm ring** — never a visible gray stroke.
2. **Everything is warm-tinted.** Hover is `rgba(33,27,23,0.05)`, rings are
   `rgba(42,28,0,0.07)` — brown-black, never `#000` and never cold gray.
3. **Muted by default.** Sidebar/nav rows are secondary ink at weight 500.
   Only the thing you're reading gets full ink.
4. **One rhythm.** Rows are 30px. Menu items 28px. Icons 12–16px. Five radii,
   three elevations, each with exactly one job. Everywhere.
5. **Sentence case, letter-spacing `normal`.** Section labels are 12px/12px
   weight 500 faint — **not** uppercase, **not** tracked.
6. **One width per page, top to bottom.** A page picks a single width via
   `PageShell` and *everything* in it shares that edge — masthead, toolbar,
   list, table. Reading surfaces get the 720px column; everything else gets
   960px; true canvases go full-bleed.
7. **Type is sized by ROLE, not by density.** Content is 16px, UI chrome is
   14px, metadata is 12px. A board-card title is *content*, so it is 16px —
   sizing it 14px is what made our cards read as UI rows instead of pages.

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

### Radius — five rungs, each with one job

**v2 supersedes v1's "two rungs".**

| Utility | Value | Its one job |
|---|---|---|
| `rounded-pill` | `4px` | select/status **pills**, block gutter buttons |
| `rounded-md` (`--radius`) | `6px` | anything you **click**: buttons, inputs, rows, menu items, chips, wells |
| `rounded-card` | `10px` | anything that is a **surface**: cards, callouts, dropdowns, popovers |
| `rounded-modal` | `20px` | **modals**, dialogs, the command palette — and view-tab pills (fully rounded at 32px tall) |
| `rounded-full` | — | avatars, dots, count badges, progress tracks |

`rounded-sm`, `rounded-md`, `rounded-lg` and `rounded-4xl` **all collapse onto
6px** — existing call sites land on the scale with no edits.

`rounded-overlay` is a **live alias of `rounded-card`** (both 10px). It has
many call sites and nothing is broken by leaving them; prefer `rounded-card`
in new code.

`rounded-xl` / `2xl` / `3xl` are **frozen legacy rungs that exist only for the
guest world**. App surfaces must never use them. If you find one in an app
file, convert it to `rounded-md` (clickable) or `rounded-card` (surface).

### Elevation — three tiers, never mixed

Each recipe ends with the **1px warm ring as its last layer**, so these
surfaces carry `border: none` and **no `ring-*` utility** — stacking a ring on
top double-rings them.

| Utility | Pair with | For |
|---|---|---|
| **`shadow-card`** | `rounded-card bg-card` | a **resting** surface that represents a *page*: board cards, gallery cards, doc cards. One soft far layer + the ring. |
| **`shadow-popover`** | `rounded-card bg-popover` | **floating chrome**: popover, dropdown, menu, toast, drag overlay. |
| **`shadow-modal`** | `rounded-modal bg-modal-bg backdrop-blur-modal` | **dialogs + the command palette**. The only tier with no ring — it sits on a translucent blurred fill, where a ring reads as a seam. |

**`shadow-overlay` is a live alias of `shadow-popover`** (identical recipe,
the pre-v2 name). Existing call sites keep working; prefer `shadow-popover` in
new code. The raw `--overlay-shadow` var is still consumed directly by
`documents-editor.css`, `stream-chat-overrides.css`, `spreadsheet.css`,
`document-drag-handle.css` and `insights/chart-style.ts` — do not rename it.

The other three shadow tokens are unchanged:

- **`shadow-tooltip`** — the tighter tooltip recipe. Tooltips are a constant
  dark slab (`bg-tooltip-bg text-tooltip-foreground`) on **both** planes —
  never `bg-foreground`, which inverts with the theme.
- **`shadow-ring`** — a bare 1px warm ring for a resting surface that needs a
  boundary but is **not** a card: wells, inputs, inline containers. It
  replaces `border border-border`.
- **`shadow-focus`** — the 1px inset+outer Notion blue focus shadow.
- **`--sidebar-edge-shadow`** — the sidebar's right edge is an inset shadow,
  not a border. Use `shadow-(--sidebar-edge-shadow)`.

**v1 said "resting cards get NO shadow" — that is now wrong for cards.** It
stays right for **wells, list rows, toolbars and section containers**: those
get `shadow-ring` or nothing. `shadow-card` means "this rectangle is a page
you can open". `shadow-sm` / `shadow-xs` / `hover:shadow-*` / `hover:-translate-y-*`
are still bugs — there is no lift, ever, and no tier outside these three.

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

### Fonts — the system stack, no webfont

**`font-sans` is the plain system stack.** Notion ships no webfont at all, and
a loaded UI face is itself a "designed template" tell. As of 2026-08-05 the
Inter `next/font` wiring is **deleted** from `app/layout.tsx` and
`--font-sans-inter` no longer exists — do not reintroduce either.

```
ui-sans-serif, -apple-system, "system-ui", "Segoe UI Variable Display",
"Segoe UI", Helvetica, "Apple Color Emoji", "Noto Sans Arabic",
"Noto Sans Hebrew", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"
```

The emoji and Arabic/Hebrew faces are *inside* the stack so a mixed-script
string never falls through to a random installed face.

`font-feature-settings` is **`normal`**. The old `"cv11","ss03","cv02"` triple
was Inter character-variant tuning; on a system face those features mean
nothing, or something else. Do not add OpenType features.

`font-mono` (Geist Mono) and the chat's Lato (`--slack-chat-font-family`) are
unaffected — they are real, deliberate faces for code and for the Slack-shaped
chat surface. `font-serif` is **guest world only**; the app shell has no serif
voice.

There is **no global letter-spacing**. Do not reintroduce `tracking-tight`,
`tracking-wide`, `tracking-widest` or `tracking-[0.18em]` on app surfaces.

### Primary — Notion blue

**`--primary` is `#2383e2`** (`#2c8ce6` on the dark plane, lifted one rung to
clear the canvas) with `--primary-foreground` `#f3f9fd`. This deliberately
**overrides the 2026-07-17 "buttons stay warm ink" decision**. It is the same
blue as `--ring` and `--icon-accent`, so focus, links and the primary action
are one family.

> **`--primary` is a BRAND ACCENT, not an ink rung.** If you want "the darkest
> text", that is `text-foreground`. `text-primary` now renders **blue** — it
> is correct for links and for the active/working state, and wrong as a
> synonym for "emphasis".

The one-primary-button-per-screen rule below matters more now that primary is
a saturated colour, not ink.

### Status pills

A pill is **the hue at ~16% alpha with the same hue darkened for ink**
(measured: fill `rgba(206,24,0,.165)`, ink `rgb(109,53,49)`). Spend as
`rounded-pill bg-pill-<name> text-pill-<name>-ink` — two families, one shape:

- **Semantic** — `success · warning · info · danger · neutral`. Lifecycle
  states. The fills are `color-mix`ed off `--success` / `--warning` / `--info`
  / `--destructive`, so the pill ramp can never drift out of sync with the
  status ramp. `neutral` is the only one whose fill is the warm-black wash
  rather than a hue.
- **Entity** — `slate · blue · green · amber · rose · violet` (`EntityColor`).
  User-**chosen** identity: labels, projects, teams, boards. Deliberately its
  own set, so a user picking "green" is not asserting "success".

Both families lighten their ink on the dark plane rather than darkening it.

**Never re-derive a chip colour from the Tailwind palette.**
`bg-blue-500/15 text-blue-700 dark:text-blue-300` is the pattern this
replaces — that ramp is cold and vibrates against the warm planes.

### Entity colors

`slate | blue | green | amber | rose | violet` (`EntityColor` in
`lib/db/types.ts`, `colorAt(i)` in `lib/onboarding/plan.ts`) for user-owned
things: spaces, labels, departments, boards.

---

## Type ramp — size by ROLE, not by density

Three roles, and which one a thing is decides its size. **Content 16 · UI 14 ·
metadata 12.** Nothing else.

| Role | Element | Size / line-height | Weight | Colour |
|---|---|---|---|---|
| — | Page title | `40px / 48px` | **700** | foreground |
| — | H2 block | `24px / 31.2px` | 600 | foreground |
| **Content** | prose, block text, callout body, **board & gallery card titles**, modal search input | `16px / 24px` | 400 | foreground |
| **Content** | Section title | `16px / 24px` | 600 | foreground |
| **UI** | row label — sidebar, nav, list rows, table name cells | `14px / 21px` | **500** | secondary-ink → foreground when active |
| **UI** | menu item label | `14px / 16.8px` | 400 | foreground |
| **UI** | **table header** | `14px / 16.8px` | **400** | **muted-foreground** — not 12px, not faint |
| **Metadata** | section label | `12px / 12px` | **500** | faint — no uppercase, no tracking |
| **Metadata** | caption | `12px / 16px` | 500 | faint |
| **Metadata** | shortcut hint (`⌘K`) | `12px` | 400 | faint |
| **Metadata** | tooltip | `12px` | 400 | tooltip-foreground |

> **A database/board/gallery card title is CONTENT (16px), not a UI label.**
> v1 flattened those to 14px and it is why our cards read as UI rows instead
> of as pages. Same for callout body and prose. If the user is *reading* it,
> it is 16px; if they are *operating* it, 14px; if it *annotates* something
> else, 12px.

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
| **Page width** | `PageShell` — `page` **960px** (default) · `prose` **720px** · `bleed` (none) |
| Table row / header | `37px` / `36px`; cell padding `7.5px 8px` |
| Board card | `260px` wide, `8px 10px` padding |
| Divider | `1px` `--border`, full panel width |

### Page width — one per page, and only `PageShell` decides it

**A page picks ONE width and every element in it shares that edge, from the
masthead to the last row.** Width is set in exactly one place —
`components/ui/page-shell.tsx`:

| `width` | max-width | use for |
|---|---|---|
| `page` | **960px** | **the default** — index, list, detail, settings |
| `prose` | 720px | reading surfaces: document editor + header, brain page detail, `ReportMarkdown`, meeting notes |
| `bleed` | none | surfaces that ARE the data canvas: kanban board / timeline / workload, calendar grids, bookings floor plan + timetable, the workflow builder, two-pane workspaces (agent, pod-bot, chatbot detail). Their masthead goes full width too, so the edge still holds. |

Rules:
- **Never** put a `max-w-*` page container on a surface — `PageShell` owns it.
  (`max-w-*` that shortens a *lede's* measure or truncates a cell is fine; it
  has no `mx-auto`, so it cannot create a second left edge.)
- **Never** nest two `PageShell`s with different widths.
- The page's own gutter goes on `PageShell`'s `className`; it lands on the
  OUTER box, outside the measure, so padding can never shrink the content
  width. That two-element structure is deliberate — see the comment in
  `page-shell.tsx`.

**Why this is a rule and not a preference.** v2 briefly wired the 720px column
into `SectionHeader size="page"` itself, chasing Notion's prose-column /
full-bleed-data contrast. Every masthead pinned to 720 while the content under
it kept its own container, so pages grew two or three left edges — the
Documents Directory measured its title at x=563, its search at x=623 and its
boards at x=326. Notion can do that contrast because a Notion page is mostly
prose; ours are a masthead plus a list, so misalignment is all you see.
`SectionHeader` now imposes no width at all.

Spacing *inside* the column is **padding, not margin**: every block is its
content height plus `8px` top *and* bottom, so two consecutive paragraphs sit
`16px` apart and collapsing margins never bite.

### Board groups — no column background, ever

A kanban/gallery **group** has no fill: cards float on the page plane, the
group header is a tinted status pill plus a faint count, and the column ends
with a labelled, unfilled `+ New` row whose hover wash is the group's own hue
(`COLUMN_PILL_CLASS` in `components/tasks/kanban.ts` is the one map; project
boards derive theirs from `statusBadgeVariants`). The only fill a group ever
takes is the transient `bg-accent-pressed` drop-target wash — no ring, no
stroke. A grey well behind a column is the single loudest "generic kanban"
tell and it is a bug.

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
| `SectionHeader` (`size="page" \| "section" \| "panel"`) | title + description + right-aligned actions. **Imposes NO width** — `PageShell` owns that, so the masthead shares its page's edge. | the ~70th inline `flex items-center justify-between` header; a serif page title; a full-width `<hr>` under the masthead (use whitespace); adding `max-w-*` here to "fix" alignment — fix it on the `PageShell` |
| `StatGroup` + `Stat` | dashboard/agenda metric strips | stat *cards*; **vertical rules between columns**; icons inside stats |
| `StatusBadge` (`tone="neutral \| success \| warning \| info \| danger \| violet"`) | domain lifecycle states — renders as a **pill**: `rounded-pill bg-pill-<tone> text-pill-<tone>-ink` | picking badge colors per domain; a `border-<tone>/30` stroke; a Tailwind-palette wash |
| `Chip` (`tone="app" \| "guest"`, `selected`) | toggleable filter/option pills | bespoke `rounded-full border` toggles; hover that changes the border |
| `TintIcon` (`tone`, from `ui/tint-card`) | the tinted icon plate on a neutral card; tone by domain: tasks=blue · bookings=coral · calendar=sage · docs/AI=lavender · forms/reports=honey | hand-rolled `rounded-lg bg-*/10` plates |

`Eyebrow`'s `guest` tone keeps its uppercase + tracking — that is the guest
world's voice and it stays. Only the `app` / `brand` tones changed.

Domain status maps stay in the domain (`lib/bookings/status-colors.ts` is the
model: statuses → tones/classes in ONE file, every surface derives from it).

**Adding a fresh shadcn component:** it will scaffold with
`rounded-lg shadow-md ring-1 ring-foreground/10` on overlays and
`focus-visible:ring-[3px]` on controls. Rewrite those to
`rounded-card shadow-popover` (or `rounded-modal shadow-modal bg-modal-bg
backdrop-blur-modal` if it's a dialog) and `focus-visible:shadow-focus` before
it lands. (`components.json` uses `baseColor: "stone"` so new components at
least scaffold on a warm ramp.)

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

> **One v2 change does reach the guest world: the sans face.** `--font-sans`
> is a single global, so dropping Inter for the system stack changed guest
> *body* text too. Everything that makes the guest world itself — the cream
> planes, the `guest-*` palette, the serif display voice, the rust accent, the
> frozen radii — is untouched, and the serif headings are unaffected because
> `--font-serif` is its own token. Pinning guest surfaces back to Inter would
> mean shipping the webfont on every page, which is exactly what v2 removes.

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

## What changed (2026-08-05, v2) — reversed rules

v2 is a **structural** pass; v1 was a token pass. These five reverse v1:

| v1 rule (2026-08-04) | v2 rule (2026-08-05) |
|---|---|
| "Two radii: 6px clickable, 10px floating" | **Five radii** — `rounded-pill` 4 · `rounded-md` 6 · `rounded-card` 10 · `rounded-modal` 20 · `rounded-full`. `rounded-overlay` is now an alias of `rounded-card`. |
| "Elevation belongs to floating overlays only. **Resting cards get none.**" | **Three tiers**: `shadow-card` (resting surfaces that *are* a page) · `shadow-popover` (floating chrome, = the old `shadow-overlay`) · `shadow-modal` (translucent + blurred). Wells and list rows still get none. |
| Primary button = warm ink (`#2c2c2b`) | **Primary = Notion blue `#2383e2`** with an `#f3f9fd` label. `--primary` is now a brand accent, not an ink rung — `text-primary` renders blue. |
| `font-sans` = Inter Variable with `"cv11","ss03","cv02"` | **The plain system stack**, `font-feature-settings: normal`. The Inter `next/font` wiring and `--font-sans-inter` are deleted. |
| `text-sm` (14px) everywhere in the UI, including card titles | **Size by ROLE**: content 16 · UI 14 · metadata 12. Board/gallery card titles, prose and callout bodies are **content → 16px**. |

And two things v1 had no opinion on, now mandatory:

| New in v2 | Rule |
|---|---|
| **The document column** | Content sits in `max-w-content` (720px, centred); **data views break out to full width**. `--content-width` is the token. |
| **Status pills** | `rounded-pill bg-pill-<name> text-pill-<name>-ink` — hue at 16% alpha + the same hue darkened for ink, across the semantic ramp *and* `EntityColor`. Replaces every `bg-blue-500/15 text-blue-700` chip. |

### What changed (2026-08-04) — the v1 reversals, still in force

If you learned the pre-Notion (Linear-inspired) system, unlearn these:

| Old rule | New rule |
|---|---|
| `Eyebrow` = "small **uppercase tracked** label", never re-type `tracking-[0.18em]` | Labels are **sentence case, 12px/12px, weight 500, faint, no tracking**. The uppercase tracked eyebrow was our single loudest "template" tell. |
| "Everything derives from `--radius` via the `--radius-sm…4xl` scale" | `sm/md/lg/4xl` all collapse to 6px; `xl/2xl/3xl` are frozen guest-only legacy. *(v1 said "two rungs only" — **superseded by v2's five rungs** above.)* |
| Cards are `border border-border bg-card` | No stroke, ever. Cards separate by **fill delta**; a non-card surface that needs a boundary uses `shadow-ring`. *(v1 said cards get no shadow at all — **superseded**: cards now take `shadow-card`, whose last layer is that same warm ring.)* |
| Separation: whitespace → hairline divider (`border-border/60`) → well (`bg-muted/50`) → card | Don't stack opacity modifiers on tokens that are already 4–7% alpha. Use them at full strength. |
| Global `letter-spacing: -0.011em` + `tracking-tight` above `text-xl` | Letter-spacing is `normal` **everywhere**. |
| `text-sm` body, `text-xs` for metadata | **14px is the UI default.** 12px is labels/captions/shortcuts only. Nothing below 12px. *(v2 adds the other half: **content is 16px** — v1 wrongly flattened card titles and prose to 14px.)* |
| `shadow-sm` on cards, `hover:shadow-sm`, `hover:-translate-y-0.5` | No lift, ever, and no shadow tier outside the three named ones. *(v1 said "floating overlays only" — **superseded**: `shadow-card` is a resting tier.)* |
| `focus-visible:ring-[3px] ring-ring/50` | `focus-visible:shadow-focus` — 1px inset + 1px outer, Notion blue. |
| `--shell-border` (deliberately darker shell outline) | Deprecated alias of `--border`. The shell is two flush planes. |
| Hover may change border + background + label color | **Fill only**, 20ms. |
