# Hotelclaw design system

Who this serves: hotel/restaurant **owners, managers, and front-line staff** —
busy people on mixed devices who need to scan, decide, and move on. Guests use
the public surfaces. The house style is **easy to read, clean, spacious, and
typographic**: whitespace and type hierarchy do the work; chrome, boxes, and
color are spent sparingly.

Two visual worlds, on purpose:

1. **Staff app** — Inter (Linear-tuned: `cv11 ss03 cv02`, −0.011em), neutral
   oklch tokens, Linear-style shell (dark outer surface + floating inset card),
   Slack-style chat (Lato lives ONLY inside the message surface via
   `--slack-msg-*` vars).
2. **Guest/cream world** (onboarding, welcome, `/g/*`, `/book/*`) — warm cream
   `#faf9f5`, ink `#1f1e1b`, terracotta accent `#c96442`, serif display +
   sans body, mobile-first, generous tap targets (44px+).

## Type ramp (staff app)

Use Tailwind scale steps only. **No `text-[Npx]` / `text-[N.rem]` arbitrary
sizes** — a normalization pass (2026-07-07) removed ~1,000 of them; don't
reintroduce.

| Role | Class |
| --- | --- |
| Page masthead (`h1`) | `text-4xl font-semibold tracking-tight` (docs Directory alone uses `text-5xl sm:text-6xl`) |
| Section title (`h2`) | `text-xl font-semibold tracking-tight` |
| Panel/card title | `text-base font-medium` |
| Body, row titles, buttons, inputs | `text-sm` (16px content bodies: `text-base`) |
| Metadata, timestamps, counts, pills | `text-xs text-muted-foreground` |
| Eyebrow / kicker | `text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground` |
| Inline uppercase micro-label (dense chrome) | `text-xs uppercase tracking-wide` |

Rules: headings never `font-bold`/`font-extrabold`, never `leading-*`
(the scale's built-in leading is the contract); `text-balance` on headings,
`text-pretty` on paragraphs; `tabular-nums` on every number that changes
(counts, times, prices, stats). Sub-`text-xs` sizes are reserved for physical
constraints only (floor-plan table glyphs, avatar initials).

## Color

Everything routes through tokens in `app/globals.css`:

- Neutrals: `background / card / muted / border / foreground / muted-foreground`
  (oklch, opacity-based hairlines — never solid `gray-200`-style borders).
- **Semantic status: `success` / `warning` / `info` / `destructive`** — added
  2026-07-07 (emerald-600/amber-600/blue-600 light, 400s dark). Never re-pick
  emerald/amber/blue shades inline for a status meaning; use the tokens or the
  maps below. `Badge` ships matching `success|warning|info` variants.
- **Brand: `brand` (#4a154b aubergine) and `brand-accent` (#cba4e6 lavender)**
  — the Slack-heritage marks (property tile, rail badge, chat active-tab
  underline).
- `icon-accent` — the Apple-Mail blue for nav/doc glyphs.

Domain color maps (single sources of truth — extend these, never fork):

- `components/labels/label-tokens.ts` — `LABEL_COLORS/LABEL_DOT/LABEL_CHIP`
  for every EntityColor dot/chip (spaces, projects, labels, boards). 18 local
  copies were deduped into this; import it.
- `lib/bookings/status-colors.ts` — `BOOKING_STATUS_UI` (badge/accent/block/
  tone per status). pending=amber, **confirmed=blue**, seated=violet,
  no-show=red, terminal=neutral.
- `lib/calendar/event-visuals.ts` — `EVENT_VISUALS` + `eventTint/eventChipClass/
  eventDotClass/eventSwatch`. meeting=blue, task=amber, booking=violet,
  google=emerald, microsoft=indigo.
- `components/insights/chart-style.ts` — chart series (grayscale ramp; color
  reserved for state).

## Surfaces & elevation

Whitespace first → hairline dividers (`border-border/40`–`/60`) → wells
(`bg-muted/30`) → cards last. Cards only for independently interactive or
truly distinct content. Elevated overlays use `ring-1 ring-foreground/10` (not
solid borders) and drop shadows in dark mode (`dark:shadow-none`). Radius
contract: cards `rounded-xl`, controls `rounded-md`/`rounded-lg` (Button),
pills `rounded-full`.

## Buttons & controls

- `components/ui/button.tsx` is the only button. Two working sizes per
  surface: `sm` (h-7) and `default` (h-8); `xs` is h-7 compact. Primary
  (`default` variant) has a real hover (`hover:bg-primary/90`) — **one solid
  primary per page/dialog**, everything else outline/ghost/secondary.
  Destructive actions are muted (`destructive` variant is a soft red) until
  the confirm step.
- Icons: lucide only, `size-4` in app chrome (`size-5` max for nav), always
  `shrink-0`, `items-start` beside multi-line text. No decorative colored
  icon containers. No emoji as UI chrome (user-chosen icons for spaces/
  services/reactions are data and stay).
- Inputs: `components/ui/input.tsx` (16px mobile / 14px desktop built in).
  Every input gets a `name` and a label or `aria-label`. Raw `<textarea>`/
  `<select>` need `max-sm:text-base` (iOS zoom). Custom controls must carry a
  visible `focus-visible` ring.
- Guest world: shared heights — chips `h-11`, inputs/buttons `h-12`, inset
  ink focus rings (`focus-visible:ring-[#1f1e1b]/25`), labels wrap their
  controls.

## Known debt (next passes, in priority order)

1. **No mobile shell.** The rail + 224px sidebar never collapse; there is no
   drawer/hamburger. This is the biggest UX gap — needs a `Sheet`-based nav
   under `md:` and a mobile pass over Timetable/Floor plan (Agenda already
   covers small screens).
2. **Native `<select>`s** (bookings/chatbots/insights dialogs, `selectClass`
   copies) — build one `ui/native-select` with the custom-chevron pattern and
   sweep call sites.
3. **Shared `EmptyState` + `SectionLoading`** — empty/loading treatments are
   still per-surface (rich-centered vs dashed one-liner vs plain "Loading…").
4. **Chatbots chat primitives** — `ChatBubble`/`ToolCallChip`/`ChatComposer`
   are hand-rolled 3× (test console, transcript, playground).
5. **Duplicated task-detail pickers** — status/priority/assignee/due-date
   pickers exist twice (inline properties + sidebar).
6. **`transition-colors` policy** — used on roughly half the color-only
   hovers; either adopt everywhere deliberately or strip (guideline says
   strip). Decide once, apply mechanically.
7. Avatar fallback sizes/rings vary per surface — fold into `ui/avatar` sizes.
8. Cream-world palette constants (`INK`/`ACCENT`…) are still per-file JS
   consts; promote to `--guest-*` CSS vars when touching those files next.
9. Pre-existing lint debt: `react/no-unescaped-entities` + setState-in-effect
   errors across ~20 files (predates the design pass).
