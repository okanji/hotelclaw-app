# Notion spec v2 — structure, not just tokens

Measured off `app.notion.com` on 2026-08-04/05 with `getComputedStyle` across
a document page, a gallery database, a **board** database, a **table** database,
and the search modal. v1 (`notion-spec.md`) fixed our *tokens*. This fixes the
*structure* — the reason the app still reads as a dashboard rather than Notion.

**v2 supersedes v1 where they disagree.** v1's radius rule ("6px clickable /
10px floating") was too coarse: there are five radii, listed below.

---

## 0. Two decisions the user made (2026-08-05)

1. **Font → the system stack.** Notion ships NO webfont. Drop Inter.
2. **Primary button → Notion blue** `rgb(39,131,222)` / `#2383e2`, white label.
   This deliberately overrides the 2026-07-17 "buttons stay warm ink" decision.
   Warm ink is no longer the primary button fill.

---

## 1. The thesis — why we still don't look like Notion

v1 made us quiet. But Notion isn't just quiet, it's a **document**:

1. **Everything lives in a 720px centred column.** Prose, headings, callouts,
   page title. Our pages are full-bleed dashboards with card grids.
2. **Data views break OUT of that column to full width.** Tables and boards go
   edge-to-edge while prose stays at 720px. That contrast IS the layout.
3. **Type is sized by ROLE, not by "smaller is denser".** Content is 16px.
   UI chrome is 14px. Metadata is 12px. v1 flattened content down to 14px in
   places — that's why our board cards read as UI, not as pages.
4. **Boards have no column backgrounds.** No gray wells. Cards float on white,
   headers are tinted status pills, and each column ends with an inline
   `+ New page` row.
5. **There are five radii and three elevations**, each with one job.

---

## 2. Typography

Font — **exactly this stack, no webfont, no features:**
```css
--font-sans: ui-sans-serif, -apple-system, "system-ui",
  "Segoe UI Variable Display", "Segoe UI", Helvetica,
  "Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew",
  Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol";
font-feature-settings: normal;   /* delete cv11/ss03/cv02 */
letter-spacing: normal;          /* everywhere, no exceptions */
```

**Size by role — the rule that matters most:**

| Role | Size / line-height | Weight | Colour | Examples |
|---|---|---|---|---|
| Page title | `40px / 48px` | **700** | primary | the H1 block |
| H2 block | `24px / 31.2px` | **600** | primary | "Media" |
| **Content** | `16px / 24px` | 400 | primary | prose, callout body, **board & gallery card titles**, modal search input |
| **UI row** | `14px / 21px` | **500** | secondary→primary | sidebar rows, table name cells, list labels |
| Menu item | `14px / 16.8px` | 400 | primary | dropdown items |
| Table header | `14px / 16.8px` | **400** | **tertiary `#7d7a75`** | property columns — NOT 12px, NOT faint |
| Section label | `12px / 12px` | **500** | faint `#a19e99` | "Private", "Today" — sentence case, no tracking |
| Metadata | `12px / 16px` | 400 | faint | shortcuts, timestamps, captions |

A database page title on a card is **content (16px)**, not a UI label. v1 got
this wrong.

---

## 3. Layout — the document column

- **Content column: `720px`, centred.** Page gutters `8px` inside it.
- **Page icon: a `78px` emoji ABOVE the title**, in the column.
- Title block padding `0 8px`.
- **Every block = its content height + `8px` padding top AND bottom**, so two
  consecutive paragraphs sit `16px` apart. Spacing is padding, not margin.
- **Block gutter controls** (`+` and `⋮⋮`) sit ~34px and ~56px to the LEFT of
  the column, `20×20`, `4px` radius, grip colour `rgb(173,169,163)`, revealed
  on row hover only.
- **Databases break out of the column to full width** (a table row measured
  1841px in a 1728px viewport — it scrolls horizontally). Prose never does.

---

## 4. Radii — five, each with one job

| Radius | Used for |
|---|---|
| `4px` | select/status **pills**, block gutter buttons |
| `6px` | buttons, inputs, menu items, sidebar rows — anything you click |
| `10px` | **cards, callouts, dropdowns, popovers** |
| `20px` | **modals**, and **view-tab pills** (fully rounded at 32px tall) |
| `full` | avatars, count badges |

---

## 5. Elevation — three tiers, never mixed

```css
/* 1. CARD — board cards, gallery cards. Resting content that is a page. */
border-radius: 10px; background: var(--card);
box-shadow: rgba(25,25,25,.027) 0 4px 12px 0,
            rgba(42,28,0,.07)   0 0   0    1px;

/* 2. POPOVER — dropdowns, menus, tooltips' bigger sibling. */
border-radius: 10px; background: var(--popover);
box-shadow: rgba(25,25,25,.05)  0 20px 24px 0,
            rgba(25,25,25,.027) 0 5px  8px  0,
            rgba(42,28,0,.07)   0 0    0    1px;

/* 3. MODAL — command palette, dialogs. Translucent + blurred. */
border-radius: 20px;
background: rgba(255,255,255,.9);
backdrop-filter: blur(40px);
box-shadow: rgba(25,25,25,.24) 0 24px 48px 0,
            rgba(25,25,25,.14) 0 4px  12px 0;
```

Dark equivalents keep the same geometry; swap the ring to
`rgba(255,255,255,.075)` and the fill to `rgba(32,32,32,.9)`.

**Note this corrects v1**: cards DO carry a (very soft) shadow. v1 said
"resting surfaces carry no shadow" — true for wells and list rows, wrong for
cards that represent a page.

---

## 6. Components — measured

**Primary button** — 28px tall, `6px` radius, `bg #2383e2`, label
`14px w500` at `rgb(243,249,253)`, padding `0 8px`.

**View tabs** (Board / Table / List switcher) — a **pill**: 32px tall,
`20px` radius, padding `6px 12px`, label `14px w500`. Active fill is the warm
hover fill `rgba(33,27,23,.05)`; inactive is transparent. **Not an underline.**

**Select / status pill** — 20px tall, **`4px` radius**, padding `0 6px`,
`14px w500`. Fill is the hue at **~16% alpha**, ink is the same hue darkened
(measured: fill `rgba(206,24,0,.165)`, ink `rgb(109,53,49)`).

**Callout** — fill `#f9f8f7` (the SAME token as the sidebar/chrome plane),
`10px` radius, `12px` padding, `1px transparent` border. Emoji at left,
body at 16px.

**Table** — row `37px`; cell padding `7.5px 8px`; **both** `border-bottom`
and `border-right` at `1px rgba(42,28,0,.07)`; header row `36px` with
`14px w400` tertiary labels preceded by a property-type icon. No zebra, no
outer frame. Name cell is `14px w500` primary.

**Board** — **no column background at all**. Column header is a status pill
plus a faint count. Cards `260px` wide, `10px` radius, card shadow, padding
`8px 10px`, title at **16px w400**. Each column ends with an always-visible
`+ New page` row tinted to the column's hue. A `+ New group` affordance sits
after the last column.

**Search modal** — `1006×700`, `20px` radius, translucent + `blur(40px)`.
Input row `16px` content size, no border. Filter chips `14px` tertiary.
Group label `12px w500` tertiary. Result rows `14px`, `6px` radius, warm fill
when selected. Footer bar `41px` with `12px` faint shortcut hints above a
hairline.

**Tooltip** — `#2c2c2b` in BOTH themes, `6px` radius, `12px`, padding `5px 8px`,
`rgba(0,0,0,.08) 0 4px 12px -2px` + `rgba(255,255,255,.05) 0 0 0 1px inset`.

---

## 7. What to change in our app

1. Font → system stack; delete the Inter `next/font` wiring and the
   `font-feature-settings`.
2. Primary button → Notion blue.
3. Add a **document page shell**: 720px centred column for content pages
   (Home, Insights prose, Documents, Agents, settings-ish surfaces), with data
   views allowed to break out full-width.
4. Type ramp → enforce role sizing; restore 16px for content titles.
5. Radii → the five-rung scale; add `4px` (pill) and `20px` (modal) rungs.
6. Elevation → the three tiers as named utilities; cards get the card shadow.
7. Kanban → delete column backgrounds, status-pill headers, inline `+ New`.
8. Tables → 37px rows, both dividers, 14px tertiary headers.
9. Tab navs → pill view-tabs, not underlines.
10. Status badges → 4px radius, 16% tint fill, darkened same-hue ink.
11. Command palette → modal tier (20px + blur(40px) + translucent).
12. Callouts/wells → chrome fill at 10px.

The guest cream/serif world stays **out of scope**, unchanged.
