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
- **Guest palette: `guest-*` tokens** (added 2026-07-12) — the entire cream
  world routes through `bg-guest-bg / bg-guest-card / text-guest-ink /
  -ink-soft / -ink-mid / -ink-faint / border-guest-line / -line-strong /
  bg-guest-line-soft / bg-guest-accent / hover:bg-guest-accent-hover /
  text-guest-accent-ink / text-guest-danger`. Never theme-switched, never
  re-typed as hex. `font-serif` is a real token (the guest display voice).

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

## Shipped 2026-07-08 (second pass)

- **Mobile shell** — below `md:` the rail + sidebar collapse into a left
  drawer (`components/shell/mobile-top-bar.tsx` renders a slim top bar +
  hamburger; the drawer reuses `LeftShell` with `forceExpanded`; it closes on
  any navigation) and the inset goes full-bleed. Desktop is untouched.
  Gotcha this surfaced: client Supabase `postgres_changes` channel TOPICS
  must be unique per mount (`` `x:${id}:${Math.random()…}` ``) — the switcher
  and sidebar sections mount twice on mobile and Supabase throws if a second
  instance touches an already-subscribed shared topic. The filter, not the
  topic, scopes the data. All client channels now do this.
- **`ui/native-select`** — the one styled `<select>` (Input metrics + custom
  chevron, 16px mobile). All 26 app-chrome selects use it; `selectClass`
  copies are gone. Width goes on `wrapperClassName`.
- **`ui/empty-state`** — the house empty state (dashed well + muted icon +
  title + body + action). Chatbots/bookings converted; convert others as
  touched. Insights loading text became skeletons.
- **`components/chatbots/chat/primitives.tsx`** — `ChatBubble`/`ToolCallChip`/
  `ToolCallList`/`ThinkingRow` shared by test console, transcript, playground.
- **`components/tasks/task-property-menus.tsx`** — shared status/priority/
  assignee/due-date menu contents + date helpers; inline chips and the detail
  sidebar both consume them (triggers stay per-surface).

## Shipped 2026-07-12 (third pass — reusable primitives)

- **Guest tokens + kit** — the cream-world palette left per-file JS consts and
  became `--guest-*` CSS vars (globals.css) + `components/guest/ui.tsx`:
  `GuestShell / GuestQuestion / GuestHint / GuestPrimaryButton /
  GuestGhostButton / GuestBigInput / GuestInput / GuestError`. The onboarding
  wizard and `/welcome` are the reference implementations (zero hex values
  left in either).
- **`ui/eyebrow`** — the ramp's eyebrow tier as a component, `tone="app"`
  (muted-foreground) or `tone="guest"` (warm gray). Stop re-typing
  `tracking-[0.18em]`.
- **`ui/chip`** — selectable pill with real `aria-pressed`, `tone="app|guest"`.
  The wizard's chip, generalized.
- **`ui/section-header`** — title/description/actions row on the ramp's
  `section` (text-xl) and `panel` (text-base) tiers; use it instead of the
  ~70th inline `flex items-center justify-between` header.
- **`ui/stat`** — `StatGroup` + `Stat`: divider-separated metric strips
  (opacity hairlines, `tabular-nums` values, truncated labels, no icons —
  stats are never cards). For agenda pulse strips, insights, workload.
- **`ui/status-badge`** — tone-driven lifecycle pill
  (`neutral|success|warning|info|danger|violet`) with a leading dot. Domains
  keep a status→tone map (the `BOOKING_STATUS_UI` pattern) and render this;
  nobody picks badge shades inline.

Adoption rule: new surfaces use these; existing surfaces convert when
touched.

## Known debt (next passes, in priority order)

1. **Section-level mobile polish** — the shell now works on phones, but dense
   views need passes: board toolbar tab row should scroll (it can crowd at
   390px), Timetable/Floor plan stay desktop tools (Agenda covers mobile),
   and the chat/info panels haven't been mobile-audited.
2. **`transition-colors` policy** — used on roughly half the color-only
   hovers; either adopt everywhere deliberately or strip (guideline says
   strip). Decide once, apply mechanically.
3. Avatar fallback sizes/rings vary per surface — fold into `ui/avatar` sizes.
4. ~~Cream-world palette constants → `--guest-*` vars~~ **done 2026-07-12**
   for tokens + wizard + welcome; the remaining cream surfaces (public
   booking wizard, guest chat, event pages, `chat-cards.tsx`, booking
   emails, onboarding/welcome loading+error files) still hardcode hexes —
   migrate to the guest kit when touched.
5. Remaining empty states (docs boards, chat info-panel tabs) → `EmptyState`;
   remaining bespoke toggles (forms `Toggle`) → a shared `Switch`.
   Section headers / stat strips / status pills: convert to `ui/section-header`,
   `ui/stat`, `ui/status-badge` as surfaces are touched.
6. Pre-existing lint debt: `react/no-unescaped-entities` + setState-in-effect
   errors across ~20 files (predates the design pass).
