# Notion visual spec — measured, not guessed

Every number below was read off `app.notion.com` with `getComputedStyle` on
2026-08-04 (light + dark). This is the reference for the Notion-style
normalization. When a value here conflicts with intuition, the measurement wins.

---

## 1. The thesis — why Notion looks good and we don't

Notion is not "minimal". It is **quiet**. Five mechanisms do the work:

1. **Almost no borders.** Surfaces separate by a ~2% background delta and a
   *sub-hairline* (7% warm-black) ring — never a visible gray stroke. Our app
   draws `border-border` on 215 files; Notion draws roughly none.
2. **Everything is warm-tinted, never neutral gray.** Hover is
   `rgba(33,27,23,0.05)`, rings are `rgba(42,28,0,0.07)` — brown-black, not
   `#000`. Neutral gray is what makes a UI look like a stock component library.
3. **Muted-by-default text.** Sidebar rows are `#5f5e59` at weight **500**, not
   near-black at 400. Only the thing you're reading is full ink.
4. **Small, tight, consistent chrome.** Rows are 30px. Radii are 6px (controls)
   / 10px (overlays). Icons are 12–16px. There is one rhythm, everywhere.
5. **Sentence case, no letter-spacing.** Section labels are 12px/12px weight
   500 muted — **not** uppercase, **not** tracked. Uppercase tracked eyebrows
   are the single loudest "template" tell in our current UI.

---

## 2. Color

### Light
| Role | Value | Notes |
|---|---|---|
| Page canvas | `#ffffff` | content is pure white |
| Sidebar / chrome | `rgb(249,248,247)` `#f9f8f7` | only ~2% off white |
| Sidebar right edge | `inset -1px 0 0 rgb(240,239,237)` | `#f0efed`, a shadow — not a border |
| Primary ink | `rgb(44,44,43)` `#2c2c2b` | body + titles |
| Secondary ink | `rgb(95,94,89)` `#5f5e59` | sidebar rows, nav |
| Tertiary ink | `rgb(125,122,117)` `#7d7a75` | inline hints |
| Faint ink | `rgb(161,158,153)` `#a19e99` | section labels, shortcuts, captions |
| Hover fill | `rgba(33,27,23,0.05)` | warm-black 5% |
| Active/pressed fill | `rgba(66,35,3,0.03)`→ use `rgba(33,27,23,0.08)` | warm |
| Ring / divider | `rgba(42,28,0,0.07)` | **the** signature warm ring |
| Focus ring | `rgb(35,131,226)` 1px inset **+** 1px outer | Notion blue |

### Dark
| Role | Value |
|---|---|
| Page canvas | `rgb(25,25,25)` `#191919` |
| Sidebar / chrome | `rgb(32,32,32)` `#202020` |
| Sidebar edge | `inset -1px 0 0 rgb(44,44,43)` |
| Primary ink | `rgb(240,239,237)` |
| Secondary ink | `rgb(188,186,182)` |
| Faint ink | `rgb(115,113,108)` / topbar meta `rgb(95,94,89)` |
| Hover fill | `rgba(255,255,255,0.055)` |
| Ring / divider | `rgba(255,255,255,0.075)` |

Both planes use the **same warm hue family**. A theme switch must not change
temperature.

---

## 3. Type

Notion ships `ui-sans-serif, -apple-system, "system-ui", "Segoe UI Variable"…`
— we keep Inter, but adopt the **sizes and weights**:

| Element | Size / line-height | Weight | Color |
|---|---|---|---|
| Page title (H1 block) | `40px / 48px` | **700** | primary |
| Body / block text | `16px / 24px` | 400 | primary |
| UI row label (sidebar, menu) | `14px / 21px` | **500** | secondary |
| Menu item label | `14px / 16.8px` | 400 | primary |
| Section label ("Private") | `12px / 12px` | **500** | faint, **no uppercase, no tracking** |
| Caption ("Get started with") | `12px / 16px` | 500 | faint |
| Shortcut hint (`⌘⌥L`) | `12px` | 400 | faint |
| Topbar meta ("Edited 2y ago") | `14px / 20px` | 400 | faint |
| Tooltip | `12px` | 400 | inverted |

Letter-spacing is `normal` **everywhere**. Our global `letter-spacing: -0.011em`
on `html` and every `tracking-[0.18em]` eyebrow both go.

Notion does **not** use `text-xs` (12px) for row labels — 12px is reserved for
labels/captions/shortcuts. UI rows are 14px.

---

## 4. Geometry

| Thing | Value |
|---|---|
| Sidebar width | `270px` |
| Sidebar inner padding | `8px` (rows are 254px wide, x=8) |
| Sidebar row | `30px` tall, `6px` radius, `1px` vertical gap (31px pitch) |
| Row icon | `12–16px`, `~8px` gap to label |
| Topbar | `44px` tall, transparent (no border, no fill) |
| Content column | `720px` max-width, centered |
| Menu / dropdown item | `28px` tall, `6px` radius, `3px 6px` padding |
| Overlay panel radius | `10px` |
| Control radius | `6px` |
| Divider | `1px`, `rgba(42,28,0,0.07)`, full panel width |

**Radius scale is exactly two values**: `6px` for anything you click, `10px`
for anything that floats. Nothing else. No `rounded-xl`/`2xl`/`3xl` sprawl.

---

## 5. Elevation

Notion has **one** elevation recipe. Light:

```css
box-shadow:
  rgba(25, 25, 25, 0.05)  0 20px 24px 0,   /* the soft far shadow    */
  rgba(25, 25, 25, 0.027) 0 5px  8px  0,   /* the tight near shadow  */
  rgba(42, 28, 0, 0.07)   0 0    0    1px; /* the warm ring, LAST    */
```

Dark:
```css
box-shadow:
  rgba(0, 0, 0, 0.30)          0 20px 24px 0,
  rgba(0, 0, 0, 0.20)          0 5px  8px  0,
  rgba(255, 255, 255, 0.075)   0 0    0    1px;
```

Tooltip (smaller, tighter):
```css
background: #2c2c2b; border-radius: 6px; font-size: 12px; padding: 5px 8px;
box-shadow: rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset;
```

Key points:
- The 1px ring is **part of the shadow**, not a `border`. Borders on floating
  panels shift layout and read harder. Every popover/dropdown/dialog/sheet
  gets the ring via `box-shadow`, and `border: none`.
- **Cards do not get shadows.** Only floating overlays do. Resting surfaces
  separate by fill, not elevation. Our `shadow-sm` on static cards goes.

---

## 6. Interaction

- Hover on any row/control: fill only — `rgba(33,27,23,0.05)`. No border
  change, no shadow, no lift, no color flip of the label.
- Transition: `background 20ms ease-in` (Notion's is near-instant). Never
  animate color on hover over 150ms — it feels laggy.
- Active nav row: hover-fill at rest (`rgba(33,27,23,0.05)`) + primary ink.
  There is **no** accent bar, no bold, no colored background.
- Focus: `box-shadow: rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`.
  Not a 3px offset ring.
- Row affordances (`•••`, `+`) appear on hover only, right-aligned in the row.

---

## 7. What this means for our tokens

`app/globals.css` changes:
- `--radius: 0.375rem` (6px) and collapse the `--radius-*` scale so `lg`/`xl`
  don't balloon; overlays use a dedicated `10px`.
- `--border` → `oklch` equivalent of `rgba(42,28,0,0.07)` — lighter and warmer
  than today's `oklch(0.3 0.03 106 / 10%)`.
- `--accent` (hover fill) → `rgba(33,27,23,0.05)`.
- `--muted-foreground` → `#7d7a75`-ish; add a `--faint-foreground` `#a19e99`
  rung for labels/captions, which today wrongly reuse `--muted-foreground`.
- `--sidebar` → `#f9f8f7` (today `#f5f5f5`, a *cold* gray — this is a big
  part of why the shell reads generic).
- Drop `letter-spacing: -0.011em` from `html`.
- Add `--shadow-overlay` / `--shadow-tooltip` custom properties so the recipe
  lives in one place.

`DESIGN.md` changes: the "eyebrow = uppercase + `tracking-[0.18em]`" rule is
reversed, the radius scale shrinks to two rungs, and cards lose shadows.

The guest world (`--guest-*`, cream + serif) is **out of scope** and must not
change — it is already a deliberate, distinct world.
