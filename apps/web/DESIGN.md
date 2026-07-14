# Hotelclaw design system

Who this serves: hotel/restaurant **owners, managers, and front-line staff** —
busy people on mixed devices who need to scan, decide, and move on. Guests use
the public surfaces. The house style is **easy to read, clean, spacious, and
typographic**: whitespace and type hierarchy do the work; chrome, boxes, and
color are spent sparingly.

Two visual worlds, on purpose:

1. **Staff app** — Inter (Linear-tuned: `cv11 ss03 cv02`, −0.011em),
   **warm-neutral oklch tokens (hue ~106 — the Anthropic/Notion ivory
   family, restyled 2026-07-14)**: ivory `#faf9f5` shell + white inset card
   in light, warm charcoal `#161512` planes in dark. Linear-style shell
   (outer surface + floating inset card), Slack-style chat (Lato lives ONLY
   inside the message surface via `--slack-msg-*` vars). The staff and guest
   worlds now share one color temperature; they differ in voice (sans vs
   serif display) and accent, not hue.
2. **Guest/cream world** (onboarding, welcome, `/g/*`, `/book/*`) — warm cream
   `#faf9f5`, ink `#1f1e1b`, terracotta accent `#c96442`, serif display +
   sans body, mobile-first, generous tap targets (44px+).

## Type ramp (staff app)

Use Tailwind scale steps only. **No `text-[Npx]` / `text-[N.rem]` arbitrary
sizes** — a normalization pass (2026-07-07) removed ~1,000 of them; don't
reintroduce.

| Role | Class |
| --- | --- |
| Page masthead (`h1`) | **`ui/section-header` `size="page"`** — `font-serif text-4xl font-medium tracking-tight` serif display + optional eyebrow + `text-base` lede (Claude-dashboard editorial pattern, componentized 2026-07-14; Home/Insights/Forms/Projects/Org/Chatbots ×2/Conversations are the reference conversions — Home is the full dashboard grammar: eyebrow + serif greeting + actions in ONE header row, then the stat-card row). Docs Directory alone stays hand-rolled at `text-5xl sm:text-6xl` |
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
  (warm oklch hue ~106, opacity-based hairlines — never solid `gray-200`-style
  borders, never cool `zinc`/`slate` grays in staff chrome).
- **Semantic status: `success` / `warning` / `info` / `destructive`** — added
  2026-07-07 (emerald-600/amber-600/blue-600 light, 400s dark). Never re-pick
  emerald/amber/blue shades inline for a status meaning; use the tokens or the
  maps below. `Badge` ships matching `success|warning|info` variants.
- **Primary = warm ink** (charcoal `oklch(0.27 0.006 106)` light / warm
  near-white dark): `bg-primary` buttons, checked switches/checkboxes,
  focus rings, today-markers. NO red/coral action buttons — a terracotta
  primary was tried 2026-07-14 and reverted the same day (read as red);
  `destructive` (delete/confirm-remove) is the only red in staff chrome.
  Terracotta stays the guest world's accent (`--guest-accent`).
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
truly distinct content. **In-flow cards are flat** (2026-07-14, the
Claude-platform treatment): `ui/card` = white surface + 1px `border-border`
hairline, no shadow. `ring-1 ring-foreground/10` + shadow stays reserved for
ELEVATED overlays (popovers, dialogs, menus), `dark:shadow-none`. Radius
contract (base `--radius` 0.5rem = Claude's 8px, 2026-07-14): cards
`rounded-xl` (~11px), buttons `rounded-lg` (8px), inner controls `rounded-md`
(~6px, the Notion control radius), pills `rounded-full`.

## Component library (shadcn, `base-nova` style on Base UI)

`components/ui/*` is the single component library — latest shadcn CLI,
`base-nova` style, Base UI primitives (NOT Radix: `render` prop, `data-checked`
/ `data-popup-open` state attrs), Tailwind v4 tokens. Add new primitives with
`pnpm dlx shadcn@latest add <name>`; never hand-roll a control that exists
here. Installed set (2026-07-14): avatar · badge · button · card · checkbox ·
chip · collapsible · command · dialog · dropdown-menu · empty-state · eyebrow ·
field · input · input-group · kbd · label · native-select · popover · progress
· radio-group · scroll-area · section-header · separator · sheet · sidebar ·
skeleton · sonner · spinner · stat · status-badge · switch · tab-nav · table ·
tabs · textarea · toggle · toggle-group · tooltip.

House decisions where shadcn offers overlap:

- **Switch**: `ui/switch` is the only toggle (the three bespoke `Toggle`
  copies in triage-dial / form-detail / workflows-list and the raw
  `role="switch"` in chatbots/actions-panel were converted 2026-07-14).
  Checked = `primary` (warm ink), not green.
- **Select**: `ui/native-select` for app-chrome selects; `command` + `popover`
  for searchable pickers. (No Base-UI Select installed — don't add a third.)
- **Empty states**: `ui/empty-state` (house), not shadcn `empty`.
- **Checkbox / radio / field**: use `ui/checkbox`, `ui/radio-group`,
  `ui/field` for new forms; raw `<input type="checkbox">` converts as touched.
- **Tabs**: `ui/tabs` for in-place content panels; **`ui/tab-nav`** (added
  2026-07-14) for navigation strips — `underline` variant for route-level
  sub-nav (render a `<Link>`), `pill` variant for toolbar filters/view
  switches. workflows-tabs, board-toolbar (×2), workload-view
  inbox, and projects-index views are converted (2026-07-14);
  channel-tabs (brand underline, deliberate) stays; document-search /
  slack-composer matches were listbox options, not tabs.
- **Loading**: `ui/spinner` + `ui/skeleton`; toasts via `sonner`.
- **`ui/stat-card`** (2026-07-14, the Claude-platform headline stat):
  quiet label + big `tabular-nums` value + one-line sub + optional
  `StatCardPill` corner chip (`warning` tone for waiting-on-a-human);
  whole-card links via `render={<Link/>}`. Home's masthead row is the
  reference (role-tuned, each card deep-links to its surface).
- **`ui/cover-card`** (2026-07-14, the Claude-platform "model card"): pastel
  cover block with ONE centered glyph (emoji or lucide line-art) + title /
  meta badge / description / small tag chips. For FULL-PAGE galleries only —
  workflow templates (tint by surface) and bookable-service cards (tint by
  kind) are the references; pickers inside dialogs stay compact text cards
  (that's the platform's pattern too). `COVER_TINTS` in the component is the
  single tint source (6 pastels, deliberately not theme-switched).
- **Headers**: `ui/section-header` — `page` (serif masthead + eyebrow + lede)
  / `section` / `panel` tiers, `eyebrow` on any tier (org-view's local
  SectionHeader was absorbed 2026-07-14).
- **Select wrappers**: `WorkflowSelect` (builder) and forms' `SmallSelect`
  are now thin wrappers over `ui/native-select` — don't fork the chevron
  again. Spreadsheet cell selects + the guest form renderer stay bespoke
  (canvas chrome / guest palette, deliberate).

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
  (opacity hairlines, `tabular-nums` values, truncated labels, no icons).
  **Three stat tiers** (2026-07-14, pick by altitude): `ui/stat-card` =
  PAGE-headline row (the Claude-dashboard stat cards — Home masthead,
  Insights pulse/workload lens tops, Bookings agenda pulse); `ui/stat` =
  section-level stacked columns; editorial-section `Stats` = the compact
  in-widget one-liner. Cards never nest inside widgets/cards.
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
5. Remaining empty states (docs boards, chat info-panel tabs) → `EmptyState`.
   ~~Bespoke toggles → a shared `Switch`~~ **done 2026-07-14** (`ui/switch`).
   Raw checkboxes (~10 files) → `ui/checkbox` as touched. ~~Raw `<select>`s~~
   **done 2026-07-14** (app-chrome ones; spreadsheet + guest renderer are
   deliberate exceptions).
   Section headers / stat strips / status pills: convert to `ui/section-header`,
   `ui/stat`, `ui/status-badge` as surfaces are touched.
6. Pre-existing lint debt: `react/no-unescaped-entities` + setState-in-effect
   errors across ~20 files (predates the design pass).
