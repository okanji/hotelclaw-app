# Hotelclaw design system

Two visual worlds, one token source. Read this before building any UI.

## The two worlds

| | **App shell** | **Guest world** |
|---|---|---|
| Who | Staff, managers, owners | Hotel guests + first-run owners |
| Where | Everything under `/p/[propertyId]` | Onboarding wizard, `/welcome`, `/book`, `/g/[botSlug]`, event pages, booking emails |
| Look | Linear-inspired: dark outer shell, floating `--card` inset, Inter, `text-sm` density | Warm cream, serif display questions, rust accent, one decision per screen |
| Theming | Light + dark (`.dark` class) | **Never theme-switches** — always cream |
| Tokens | `background/card/muted/border/primary…` | `guest-*` |

## Tokens (`app/globals.css`)

All colors are CSS variables mapped through `@theme inline` — use utilities,
never raw hex values in components.

**App semantic ramp** — `--success` / `--warning` / `--info` / `--destructive`
is the ONE source for state colors (badges, dots, meters). Never re-pick
emerald/amber/blue shades inline. Violet (occupied/in-progress) is the only
state color used directly (`violet-500` family).

**Guest palette** — `bg-guest-bg`, `bg-guest-card`, `text-guest-ink`,
`text-guest-ink-soft` (body), `text-guest-ink-mid` (chip text),
`text-guest-ink-faint` (eyebrows, hints), `border-guest-line`,
`border-guest-line-strong` (hover), `bg-guest-line-soft` (tracks),
`bg-guest-accent` / `hover:bg-guest-accent-hover` / `text-guest-accent-ink`
(rust), `text-guest-danger`. If you find yourself typing `#c96442` or
`#faf9f5`, stop — the token exists.

**Radius** — everything derives from `--radius` via the `--radius-sm…4xl`
scale. Don't invent radii.

**Fonts** — `font-sans` (Inter Variable, OpenType-tuned), `font-mono`
(Geist Mono), `font-serif` (guest display voice — pinned stack, deliberate).

**Entity colors** — `slate | blue | green | amber | rose | violet`
(`EntityColor` in `lib/db/types.ts`, `colorAt(i)` in `lib/onboarding/plan.ts`)
for user-owned things: spaces, labels, departments, boards.

## Primitives (`components/ui/`)

Beyond the shadcn set (button, card, badge, dialog, sidebar…), the house
primitives — **use these instead of hand-rolling**:

| Component | Use for | Never |
|---|---|---|
| `EmptyState` | every "nothing here yet" moment | ad-hoc centered flex + icon |
| `Eyebrow` (`tone="app" \| "guest"`) | small uppercase tracked labels above headings/date groups | re-typing `tracking-[0.18em]` |
| `SectionHeader` (`size="page" \| "section"`) | title + description + right-aligned actions | the ~70th inline `flex items-center justify-between` header |
| `StatGroup` + `Stat` | dashboard/agenda metric strips | stat *cards*; icons inside stats; non-`tabular-nums` values |
| `StatusBadge` (`tone="neutral \| success \| warning \| info \| danger \| violet"`) | domain lifecycle states | picking badge colors per domain |
| `Chip` (`tone="app" \| "guest"`, `selected`) | toggleable filter/option pills | bespoke `rounded-full border` toggles |

Domain status maps stay in the domain (`lib/bookings/status-colors.ts` is the
model: statuses → tones/classes in ONE file, every surface derives from it).
New domains map their statuses to `StatusBadge` tones the same way.

## Guest kit (`components/guest/ui.tsx`)

For any guest-world surface: `GuestShell` (cream canvas), `GuestQuestion`
(serif display), `GuestHint`, `GuestPrimaryButton` (the ONE rust pill per
screen), `GuestGhostButton` (Back/Skip), `GuestBigInput` (serif underline),
`GuestInput` (rounded secondary), `GuestError`. Combine with
`<Chip tone="guest">` and `<Eyebrow tone="guest">`.

The onboarding wizard + `/welcome` are the reference implementations. The
remaining guest surfaces (public booking wizard, guest chat, event pages,
booking emails) still carry hardcoded hexes — migrate them to the kit/tokens
when touched.

## House rules

- **One primary button per screen** (dialogs count as their own screen);
  everything else is ghost/outline/muted. Max two button sizes per view.
- App-shell type: `text-sm` body, `text-xs` only for metadata; headings
  `font-semibold` (never `font-bold`), `tracking-tight` above `text-xl`,
  `text-balance` on headings, `text-pretty` on paragraphs.
- Numbers that change get `tabular-nums`.
- Separation: whitespace → hairline divider (opacity-based, e.g.
  `border-border/60`) → well (`bg-muted/50`) → card. Cards only for
  independently interactive or fundamentally distinct content.
- Dark mode = same contrast ratios, not inverted colors; `dark:shadow-none`;
  borders/dividers stay opacity-based so they work on both planes.
- Spacing between flex/grid children: `gap-*` on the parent, not margins.
- Hover states and `transition-*` only on interactive elements; transitions
  for movement, not color flips.
- Icons: `size-4` default, `shrink-0` in flex rows; no icons in stats.
- `role="list"` on every `<ul>`/`<ol>` without `list-style`.
