<!-- MONOREPO NOTE: This app lives at `apps/web` in a turborepo (sibling: the Expo
app at `apps/mobile`). Every path below — `lib/…`, `scripts/…`, `.env.local`,
`node_modules/next/dist/docs/` — is relative to `apps/web`. Run dev/scripts from
`apps/web` (or `pnpm --filter web <script>` from the repo root). -->

# Design system — read DESIGN.md before building UI

`DESIGN.md` is the design contract: two visual worlds (staff app vs the
warm-cream guest world), the token layer (`app/globals.css` — semantic status
ramp, `guest-*` palette, radius/font tokens), the type ramp, and the house
primitives (`ui/eyebrow`, `ui/chip`, `ui/section-header`, `ui/stat`,
`ui/status-badge`, `ui/empty-state`, `components/guest/ui.tsx`). Never
hardcode hex colors — a token exists. New surfaces use the primitives;
existing ones convert when touched.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI bot end-to-end testing — use this before reporting AI changes done

When working on anything that touches the in-channel AI bot — `lib/stream/ai-*.ts`, `lib/ai/*.ts`, `app/api/stream/webhook/message-new/route.ts`, `app/api/stream/ai/*`, `components/chat/info-panel/ai-tab.tsx` — **run the bot test harness before claiming the change works**. Unit tests don't exercise the webhook → classifier → generateText → Stream-post pipeline; this harness does.

```bash
# Full functional coverage (all 4 modes: mention / auto / always / engaged)
node --env-file=.env.local scripts/bot-chat-test.mjs suite

# Stress (thread reply, 6-turn engaged with tool-history persistence, rapid-fire)
node --env-file=.env.local scripts/bot-chat-test.mjs stress

# One-off probe
node --env-file=.env.local scripts/bot-chat-test.mjs send \
  --mode engaged --mention --message "@hotelclaw what's blocked?"

# Inspect / clear current channel state
node --env-file=.env.local scripts/bot-chat-test.mjs state
node --env-file=.env.local scripts/bot-chat-test.mjs reset
```

**Prerequisites** (one-time; check these are still true before running):
- `pnpm dev` running on `localhost:3000` (other local projects sometimes squat :3000 — if Next bumps the port, tunnel to the bumped port instead)
- `ngrok` tunnel up, Stream webhook event-hook pointing at `<ngrok>/api/stream/webhook/message-new`
- `.env.local` has `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `STREAM_API_SECRET`

**The webhook is SHARED between dev and prod** — Stream has one app-level
`message.new` hook. While it points at your ngrok tunnel, the prod bot is
silent; when your tunnel dies with the hook still pointed at it, the bot is
dead everywhere (this has happened). Manage it with the script:

```bash
node --env-file=.env.local scripts/configure-stream-webhook.mjs status  # where does it point now?
node --env-file=.env.local scripts/configure-stream-webhook.mjs dev     # start of a local session (resolves ngrok automatically)
node --env-file=.env.local scripts/configure-stream-webhook.mjs prod    # ALWAYS run when done developing
```

**When the harness fails**, the failure mode + classifier reason in `/tmp/hotelclaw-dev.log` (`[ai-trigger:*]` lines) tells you what the bot decided and why. Treat failures as real bugs — most have surfaced root issues (PostgREST joins, history-pattern mimicry, race conditions, classifier prompt drift) rather than test-harness flakiness.

The harness writes real Stream messages to `prop-697681e8-food-and-beverage-5d05af` as a test user (`bot-tester`). Use `--channel <id>` to target a different one.

# Two-tier AI architecture — read before adding a new bot or AI capability

This app has a **two-tier AI architecture** (plan: `~/.claude/plans/breezy-noodling-turing.md`). Know which tier your change belongs in before you write code.

## Tier 1 — In-app bots (live in this repo)

Many lightweight, purpose-specific bots, each scoped to a single feature surface:
- **Channel bot** — `lib/stream/ai-reply.ts` (built — auto mode's classifier (`lib/stream/ai-auto-classifier.ts`) has two sensitivity-independent ALWAYS-respond rules: the message continues a conversation with the bot, or it asks for something on the bot's capability list. Replies can carry **rich UI** via the `render_ui` tool (`lib/ai/tools/render-ui.ts`): the model emits a @json-render spec over the house catalog in `lib/ai/chat-ui/catalog.ts` (Stack / DataTable / CardGrid / Card / StatRow / Stat — zod-validated + size-capped server-side), posted as Stream attachment `{type:"ai_ui", spec}` and rendered by `components/chat/ai-ui-attachment.tsx` (json-render's `Renderer` MUST be wrapped in `JSONUIProvider` even for static specs). **Deep links**: the model attaches entity refs (`Card.link` / `DataTable.rowLinks` = `{kind: task|project|document|meeting|form|space, id}` — ids come from tool results, which return `id` for this purpose), and the tool validates each id against the property (batched per kind) and rewrites refs into `/p/<pid>/<section>/<id>` hrefs before the spec is stored; the stored-spec `href` fields must match `INTERNAL_HREF_RX`, so nothing external/scripted can render. Clickable rows/cards navigate via next/link. @json-render is pinned exact (pre-1.0 churn); we deliberately don't use `catalog.prompt()` — the compact tool description in the catalog file is the model's manual. Markdown tables that still slip through get fallback styling in `app/stream-chat-overrides.css`.)
- **Liveblocks comment bot** — `lib/ai/bot-scaffold.ts` (built)
- **Task detail bot** — `lib/ai/bots/task-bot.ts` + `app/api/properties/[propertyId]/tasks/[taskId]/ai/route.ts` + `components/tasks/task-ai-panel.tsx` (built)
- **Document bot** — `lib/ai/bots/doc-bot.ts` + `app/api/properties/[propertyId]/documents/[documentId]/ai/route.ts` + `components/documents/document-ai-panel.tsx` (built — Q&A + inline write via `propose_document_content`, with the bot's HTML output covering paragraph, headings, lists, blockquote, code, tables, callouts. Floating-toolbar inline rewrite is wired separately via Liveblocks's `AiToolbar` + the `resolveContextualPrompt` endpoint at `/api/properties/[propertyId]/documents/[documentId]/ai/contextual`.)
- **Calendar AI** — Liveblocks Copilot wired in `components/calendar/calendar-ai-panel.tsx` (built — uses Liveblocks's `AiChat` rather than `runBot()`, since it lives inside a Liveblocks room)
- **Insights bot** — `lib/ai/bots/insights-bot.ts` + `app/api/properties/[propertyId]/insights/{report,brief,annotations}/route.ts` (built — three generators for the Insights rail section, all reading the deterministic metrics in `lib/insights/metrics.ts` (the same functions the dashboards chart) and never computing numbers themselves: **(1) automatic intelligence brief** — typed insight cards via `generateObject` from `lib/insights/trends.ts` signals + `anomalies.ts`, fingerprint-cached in `insight_briefs` (one row/property, migration 0046), served stale-while-revalidate (`after()` regeneration + realtime swap-in) and refreshed by a daily cron (`/api/insights/refresh-briefs`); **(2) weekly management + staff reports** — markdown, cached per (property, week, audience) in `insight_reports` (0044) with an event-count freshness check, Monday cron (`/api/insights/weekly-report`) + `briefing` notifications; **(3) Haiku one-line risk annotations** on flagged projects, rollup-fingerprint-cached in `insight_annotations` (0045). Action deep-links in brief cards are validated server-side against real task/project ids. Smoke-test the SQL shapes with `node --env-file=.env.local scripts/insights-smoke.mjs`.)
- **Insights Q&A bot** — `lib/ai/bots/insights-qa-bot.ts` + `/api/properties/[propertyId]/insights/ask` + `components/insights/insights-ask-panel.tsx` (built — "Ask the numbers" dock on Insights; stateless task-bot pattern; tools are the deterministic metric functions per scope lens, ids tenant-validated, every figure cited as `(metric · lens)`; owner/manager only)
- **Shift-brief bot + handover** — `lib/ai/bots/shift-brief-bot.ts` over the deterministic gather in `lib/insights/shift-brief.ts` (built — per-user "since your last shift" brief; cursor + fingerprint cache in `shift_briefs` (0052); Haiku writes only the orientation paragraph, the UI renders the payload directly incl. one-tap task creation from unowned meeting action items; Home widget + staff My Week section. "Draft my handover" (`/api/properties/[propertyId]/handover/draft` + publish, `handovers` 0053) drafts four sections from the same window data; the human edits and publishes to a Stream channel under their own name)
- **Predictive + alert layer (no model in the number path)** — `computeSlipFlags` in `lib/insights/metrics.ts` (likely-to-slip = runway < p75 cycle time of comparable completed work; new `likely_to_slip` attention kind feeds brief watch-cards), `lib/insights/alerts.ts` (`sweepInsightAlerts` — edge-triggered project-pace/task-slip notifications via the 10-min sweep cron, state in `insight_alert_state` 0051; `evaluateAlertRules` — user thresholds from `insight_alert_rules`, run by refresh-briefs), email delivery (`insight_follows`/`email_prefs`/`insight_email_log` 0054, `lib/email/send-insight-email.ts` inline-HTML house pattern, `/api/insights/send-digests` cron 07:30 — delivery renders cached briefs/reports, never generates)
- **Pinned insight prompts** — `refreshPinnedPrompt` in `lib/ai/bots/insights-qa-bot.ts` + `/api/properties/[propertyId]/insights/prompts` + `components/insights/pinned-prompts.tsx` (built — a user pins a recurring question from the ask dock; the Q&A bot's answer is cached in `insight_prompts` (0055) against the lens's metrics fingerprint, so a card re-answers only when the numbers move; SWR via route `after()`, capped per user)
- **Intake triage bot** — `lib/ai/bots/triage-bot.ts` + `/api/properties/[propertyId]/tasks/[taskId]/suggestions` + `triage-settings` (built — Haiku suggests team/assignee/priority for bare new tasks, triggered by `after()` in `createTask`; values validated against real candidate lists, evidence = deterministic similar-task overlap; trust ladder in `task_suggestions`/`triage_settings` (0056): accept/dismiss chips on task detail (`task-triage-suggestions.tsx`), owner-only auto-apply dial with acceptance stats in the board toolbar (`triage-dial.tsx`); auto-applied fields stay badged)
- **Recurrence + chatter evidence on brief cards** — `lib/insights/recurrence.ts` (built — two extra inputs to `generateInsightsBrief`: **(a)** deterministic recurrence signals (tasks reopened ≥2×, tasks re-entering blocked ≥2×, near-identical meeting action-items resurfacing across ≥2 meetings, Jaccard-grouped — no model) whose digest extends the brief fingerprint, so a resurfacing blocker regenerates the brief even when headline numbers haven't moved; **(b)** chatter evidence — verbatim lines from flagged-projects' team channels (Stream, via `project_spaces`) + meeting extractions, gathered ONLY when deterministic pace flags exist (the cost gate). Cards gained a nullable `evidence {quote, source}` field; quotes are validated verbatim against the supplied lines server-side (source forced from the matching line) — a paraphrase becomes null. Rendered as a quote block on the card in `intelligence-strip.tsx`.)
- **Catch-up summaries** — `lib/insights/catch-up.ts` + `lib/ai/bots/catch-up-bot.ts` + `/api/properties/[propertyId]/catch-up/[subjectKind]/[subjectId]` + `components/insights/catch-up-banner.tsx` (built — per-user "since you last looked" banner on project/space detail headers; cursor + fingerprint cache in `catch_ups` (0060, shift-brief row shape); deterministic counts/highlights from scoped `workflow_events`, Haiku writes only the one-line read; renders nothing when nothing changed; "Mark read" advances the cursor)
- **Per-card provenance + audio brief** — brief cards carry `basis: string[]` (built — every deterministic signal handed to the brief generator gets a stable id; the model cites which signals each card rests on; ids are resolved server-side to the human-readable evidence lines and unknown ids dropped, rendered as a "From N deterministic signals" disclosure in `intelligence-strip.tsx`). The shift-brief widget has a Listen toggle (browser `speechSynthesis` over the same deterministic payload it renders — no backend).
- **MCP server (external AI surface)** — `app/api/mcp/[transport]/route.ts` via `mcp-handler` + `lib/mcp/tokens.ts` (built — read-only MCP endpoint at `/api/mcp/mcp` (streamable HTTP) exposing the deterministic insights layer to external clients: list_lenses, get_flow_metrics, get_attention, get_portfolio, get_workload, get_operations, get_intelligence_brief (cached, never generates), get_weekly_report. Auth = property-scoped `api_tokens` (0064, SHA-256 hashes only at rest, `hc_…` plaintext shown once); the token→property binding is the tenant isolation — propertyId always comes off the verified token, never the caller. Owner-managed via the key icon on the Insights header (`api-access-dialog.tsx`).)
- Search bot — planned

## Guest-facing custom chatbots (Chatbase-style builder)

Property members build **agentic chatbots for hotel guests** (front desk, room service, restaurant orders) under the Chatbots rail section. Guests are NOT app users — this is the app's first public surface.

- **Data**: migration 0061 — `chatbots` (versioned `config` JSON per `lib/chatbots/schema.ts`, unguessable `public_slug`), `chatbot_knowledge_sources`/`_chunks` (FTS via `search_chatbot_chunks` RPC + app-layer OR-fallback in `lib/chatbots/retrieval.ts`; `embedding vector(1536)` reserved for hybrid later), `chatbot_conversations`/`_messages` (service-client writes only; members read via RLS), `chatbot_usage_daily` (budget truth + `increment_chatbot_usage` RPC).
- **Runtime**: `lib/ai/guest-bot/run-guest-bot.ts` — `streamText`, deliberately NOT `runBot()` (guests are untrusted: no gbrain/delegate/property tools, injection-hardened prompt, Haiku/Sonnet per `config.modelTier`). Tools from `lib/ai/guest-bot/tools/registry.ts`, built ONLY from the bot's enabled actions, each with a Chatbase-style natural-language `whenToUse` appended to the tool description: `search_knowledge`, `save_guest_details`, `create_ticket` (→ `tasks` with `source:'ai'` + Stream channel card + `chatbot.order_created` event), `handoff_to_human` (`performGuestHandoff` — the status flip structurally mutes the bot, checked BEFORE generation; Stream card, `guest_escalation` notifications, `chatbot.escalated` event). Actions emit workflow events (`source:'chatbot'`, trigger catalog in `lib/workflows/catalog/chatbots.ts`).
- **Public surface**: `/g/[botSlug]` page (warm cream/serif, mobile-first, allowlisted in `lib/supabase/middleware.ts`) + `/api/guest/chatbots/[slug]/{session,messages}` — HMAC session tokens (`lib/chatbots/guest-session.ts`, localStorage Bearer; secret `CHATBOT_SESSION_SECRET`, falls back to `STREAM_API_SECRET`), layered Upstash rate limits + daily/session caps (`lib/chatbots/limits.ts`), plain-text streaming; non-generation outcomes are JSON `{state}` the client branches on by content-type; guests poll while escalated (no anon Realtime).
- **Builder**: `components/chatbots/*` — list, template gallery (`lib/chatbots/templates.ts`) + "describe it" AI draft (`/api/properties/[propertyId]/chatbots/generate`, Haiku `Output.object`), tabbed editor (Build / Knowledge / Conversations / Settings+Deploy with QR via `react-qr-code`) beside an always-on sandbox TestConsole (`.../test` route — real runtime, simulated side effects, live knowledge search; `.../train` chunks sources via `lib/chatbots/ingest.ts`). Staff reply surface: conversation page with Supabase Realtime + take-over / return-to-bot (`sendStaffReply`/`setConversationState` in `components/chatbots/actions.ts`).
- **Custom HTTP actions** (migration 0062, `chatbot_custom_actions`): staff define arbitrary HTTPS API calls the bot can make — Chatbase 4-step wizard in `components/chatbots/custom-actions-panel.tsx` (general → request → params → live test → response field allowlist). Executor `lib/chatbots/custom-actions.ts`: HTTPS-only with DNS-resolved private-IP SSRF guard, no redirects, 10s timeout, 20KB JSON-only responses, dot-path allowlist before the model sees data. Header values AES-256-GCM encrypted at rest (`lib/chatbots/crypto.ts`) and never returned to the client (only names). Tools named `custom_<slug>`; they run live even in the test console.
- **Widget embed**: `public/chatbot-widget.js` (script-tag → floating bubble → iframe of `/g/<slug>?embed=1`; same-origin inside the iframe so no CORS). Framing is locked by a per-bot `frame-ancestors` CSP set in `lib/supabase/middleware.ts` from `chatbots.allowed_domains` (empty = no embedding). The script path is allowlisted in `isPublic` (the root matcher only exempts image extensions).
- **Hybrid retrieval** (fail-soft): set `OPENAI_API_KEY` and retrain → chunks get `text-embedding-3-small` vectors (`lib/chatbots/embeddings.ts`) and `search_chatbot_chunks_hybrid` (RRF: vector + FTS, 0062) takes over in `retrieval.ts`; without the key everything stays FTS+OR-fallback.
- **WhatsApp/SMS**: per-bot `twilio_number` (Deploy tab) + one shared webhook `/api/guest/channels/twilio` — `To` routes to the bot, the guest's `From` IS the session token, channel `whatsapp|sms`. With `TWILIO_ACCOUNT_SID/AUTH_TOKEN` set, the webhook acks empty and replies via REST in `after()` (15s webhook timeout); without creds it replies synchronous TwiML (and skips signature validation with a warning). Staff replies from the conversation viewer push out via Twilio REST when configured (`lib/chatbots/twilio.ts`).
- **Feedback**: guests thumb bot replies (PATCH on the guest messages route → `chatbot_messages.feedback`); shown next to timestamps in the staff transcript.
- **Smoke test** (run before claiming guest-bot changes work): `node --env-file=.env.local --no-network-family-autoselection scripts/chatbot-smoke.mjs` — seeds a throwaway bot, exercises session → knowledge answer → custom action (live dummyjson call through the encrypted-header executor) → thumbs → widget/CSP → Twilio webhook → order→task → handoff → muting over real HTTP against the dev server, cleans up after itself.
- **In-channel deployment** (migration 0063, `chatbot_channel_deployments` — one bot per channel): the channel-bot pipeline checks `resolveChannelDeployment()` (`lib/chatbots/channel-deployment.ts`) in `generateAndPostReply`; a deployed channel swaps in the custom bot's persona (staff-context preamble appended) and merges `buildChannelDeploymentTools` (its knowledge search + custom actions) on top of `buildPropertyTools`. No deployment row → default channel bot byte-for-byte unchanged. Picker lives in the Deploy tab (`setChannelDeployments`).
- **Analytics tab**: deterministic counts (orders, escalations, thumbs, 14-day volume from `chatbot_usage_daily`) + Haiku-labeled topic/sentiment cached on conversation rows (0063 columns, batch-classified lazily by `classifyConversations` in `lib/chatbots/analytics.ts` when the tab's GET route loads; ≤25/load, settled conversations only, ids validated). "Trending negative" badge on topics with ≥⅓ negative conversations.
- **Playground compare**: TestConsole → Compare opens `playground-dialog.tsx` — two synced panes sending the same message through the test route with per-pane `override` (modelTier/instructions/onlyFromSources, applied without saving).
- **Auto-retrain**: `/api/chatbots/auto-retrain` cron (04:30, vercel.json) — retrains bots whose document sources are older than the doc's `body_updated_at` or whose url sources are >24h stale.
- **Gotchas**: `/chatbots` must match before `/chat` in `sectionFromPath`; chatbots pages are server-rendered (rail pushState exception, like meetings); extension functions/types/operators need `extensions.` qualification in migrations (`extensions.gen_random_bytes`, `extensions.vector`, `operator(extensions.<=>)`).

## Bookings — bookable services + chatbot reservations

Property members define **bookable services** (tables, spa appointments, tours) under Home → Bookings; chatbots take reservations against real availability via the `book_service` action. Industry-converged model (OpenTable/Calendly/FareHarbor research): weekly hours + slot interval + duration + capacity-per-slot, party size consuming capacity for tables/tours (covers/seats) and not for appointments.

- **Data** (migration 0065): `bookable_services` (versioned `schedule` JSON per `lib/bookings/schema.ts`, per-service IANA `timezone`), `bookings` (human `reference` BKG-XXXXXX, statuses `pending|confirmed|completed|cancelled|no_show`, source `chatbot|staff`, links to chatbot/conversation). `chatbot_conversations.outcome` gained `booking_made`. Realtime publication on `bookings` drives the live agenda.
- **Availability** — `lib/bookings/availability.ts`, 100% deterministic (NO model in the slot path): `computeDaySlots` (range end = last-seating boundary; occupancy may overrun it — turn-time semantics), `createBookingChecked` (server-side revalidation + post-insert oversell rollback, newest yields; emits `booking.created`). **Timestamps without an offset are interpreted as wall time in the SERVICE timezone** — never the server's (a bot once booked 12:00Z for "14:00" because `new Date("…T14:00")` parsed server-local).
- **Chatbot action** `book_service` (config: serviceIds allowlist, autoConfirm vs pending-for-staff, notify channel) → two registry tools: `check_availability` (lists services / returns ≤8 slots + `today_at_property`, never invents) and `create_booking` (confirm-before-book flow; flips outcome `booking_made`, posts Stream card, returns reference). The guest system prompt includes a now-line (UTC) so "tomorrow at 7" resolves.
- **Staff UI** — `/p/[propertyId]/bookings` (Home rail, `components/bookings/*`): service cards + editor (weekly-hours per-day toggles, slot rules, timezone), day agenda with Fresha-style status actions (pending→confirm/cancel; confirmed→complete/no-show/cancel), manual walk-in dialog whose slot grid uses the same engine with the notice rule relaxed. Workflow triggers `booking.created`/`booking.cancelled` in `lib/workflows/catalog/bookings.ts` (source `'booking'`).
- **Smoke coverage**: chatbot-smoke seeds a capacity-1 service, books via two-turn confirm flow, asserts the row + event, then a second guest's double-book attempt must leave exactly 1 active booking in the slot.
- **App integrations** (Bookings is a first-class rail section, not a Home quick-link):
  - **Shell** — own `ShellSection` with sidebar views (Agenda / Pending / Services via `?view=`), amber pending-count rail badge fed by `lib/query/booking-queries.ts` and invalidated by the Realtime subscription in `components/shell/sections/bookings-section.tsx`. Server-rendered → rail pushState exception (`BOOKINGS_ROUTE`).
  - **Workflows** — surface `'bookings'` (badge violet/Ticket): triggers `booking.created`/`booking.cancelled` + actions `action.booking.create` / `action.booking.set_status` (`lib/workflows/runners/bookings.ts`, same `createBookingChecked` engine, notice rule bypassed like staff; field-defs in `lib/workflows/field-defs.ts`). Canonical loop: chatbot books pending → `booking.created` trigger → `action.booking.set_status` auto-confirms small parties.
  - **Calendar** — `BookingEvent` source variant (violet tint, cancelled/no-show excluded), toggleable `internal:bookings` source, read-only `BookingDetails` in the event dialog deep-linking to Bookings. Calendar-AI knowledge and the "Your day" widget pick bookings up automatically via the shared feed.
  - **Home** — "Today's bookings" widget (`components/home/widgets/bookings-widget.tsx`): next-24h rows + pending count.
- **Table mode** (migration 0066 — the restaurant layer, generic to any discrete-unit service): `bookable_services.booking_mode` `capacity|tables`; `service_resources` = tables (name/seats/min_party/shape + 100×100-grid floor position/zone); `bookings.resource_id`; status lifecycle gained **`seated`** (occupies capacity like pending/confirmed; confirmed→Seat→Finish). Availability in table mode = a free table FITS the party (`freeFittingTables` — min_party keeps deuces off 6-tops, smallest-fit assignment per OpenTable's documented order; unassigned overlapping bookings conservatively consume free tables); `createBookingChecked` auto-assigns best-fit with per-table conflict rollback→reassign. Combos/reflow/sections = deferred upgrade path (research: not baseline).
- **Service-scoped workspaces** (`components/bookings/service-workspace.tsx`): the sidebar lists **one item per service** (emoji icon, `?service=<id>`), each opening a kind-specific workspace — the service KIND decides the UI vocabulary: `tables` → Reservations | Floor plan | Timetable tab strip; `event` → **TicketingView** (event-date chips, sold/capacity meter + checked-in count, searchable alphabetical door list with one-tap Confirm/Check-in `DoorRow`s); `rental` → units Timetable (Timetable's resource-rows mode now covers `booking_mode 'rental'` too; covers footer + seats sub hidden for rentals) + "N out now" badge + day sheet; capacity (spa/tour) → scoped day agenda. Cross-service screens stay: All bookings (agenda + stats), Pending; "Manage services" replaces the old Services item; Floor plan/Timetable left the sidebar (they live inside the table service's workspace; `?view=floor|timetable` URLs still work). Sidebar services come from `bookingServicesQueryOptions` with Realtime invalidation on `bookable_services`. `BookingStatusBadge` takes `eventKind` (seated → "Checked in").
- **Views** (Bookings sidebar): Agenda · Pending · **Floor plan** (`components/bookings/floor-plan.tsx` — one canvas, two modes: Live host board with status-colored tables — clicking a table opens a sidebar `TableDetailPanel` (current party + status actions, "Later today" upcoming, and a **seat-a-walk-in form on free tables** → `seatWalkIn` action: deliberately a direct service-client insert at "now" with a same-table overlap guard, NOT `createBookingChecked`, because the engine only accepts slot boundaries and walk-ins arrive at 19:43; emits `booking.created`), click-booking-then-table still moves parties, time scrubber; explicit Edit layout mode with drag/snap, inspector, and a Haiku "describe your room" layout draft via `.../generate-floor` — model names tables, positions assigned deterministically. Creation path: empty canvas has Add-a-table / Draft-with-AI CTAs; the Floor view without any table-mode service shows a New-table-service CTA) · **Timetable** (`timetable.tsx` — rows = tables + Unassigned lane, x = time, blocks span turn time, now-line, click for status/move actions; capacity services get packed lanes; desktop-only, mobile uses Agenda) · Services (booking-mode picker in the dialog).
- **Events + rentals** (migration 0067 — the engine is now use-case-generic): kinds gained `event` (GA party ticketing: capacity = tickets, party = ticket count, **`schedule.dates`** date-specific hours override weekly so one-off galas exist; `seated` doubles as door check-in; `priceLabel` = display-only "reserve now, pay at the door" per research — no payments) and `rental` (booking_mode `'rental'`: named units via `service_resources`, guest-chosen duration from **`schedule.rentalDurations`** discrete options — Boatsetter convention, shortest = default via `resolveDuration` — plus **`turnaroundMinutes`** cleaning/refuel gap padding every conflict window). `closedDates` block any date. Bot tools accept `duration_minutes`; `describeService` advertises price/duration options/event dates. Tiers/occurrence-series/deposits = deferred. **Ticketing is first-class across every surface** (kind `event` flips the language + artifacts everywhere): public wizard says "Get your tickets"/"Reserve tickets"/"N tickets" with a step indicator; confirmation email says "Your tickets are reserved" + QR hint; the manage page becomes the ticket — `components/public-booking/ticket-qr.tsx` renders a door QR (react-qr-code, QR of the manage URL itself) + mono reference + "Show this at the door", and `seated` reads "Checked in"; staff agenda rows show "N tickets" and the Seat action relabels "Check in"; the Services grid shows a next-date sold/capacity meter per event (computed client-side in `BookingsView.eventStatsByService`, green→amber ≥80%→red ≥100%).
- **Event ticket pages** (Luma-pattern research, no migration): each event gets a customizable public landing page at `/book/<property-slug>/event/<serviceId>` (`app/book/[propertySlug]/event/[serviceId]/page.tsx` + `components/public-booking/event-page.tsx`) — square cover art with a big emoji (**~25 `EVENT_COVER_PRESETS`** ordered basic flats → soft washes → vibrant gradients → layered "cosmic" radial/conic backgrounds; keys are stored in configs — never rename), sticky cover column with a Hosted-by block (accent initial avatar; repeats below About on mobile), serif title, calendar-tile date chip with start–end time range, two-line location row (place + property), registration card with a muted Luma-style header strip (live tickets-remaining from the slots API incl. "Almost gone" ≤20% and Sold-out states, date/time/qty chips, name+email → same POST as the wizard), whitespace-pre-line About section, backlink to the property wizard. Customization lives in **`schedule.page`** (versioned JSON in `ServiceScheduleZod`: coverStyle preset from `EVENT_COVER_PRESETS`, coverEmoji, accent hex, tagline, location, host, about) — staff edit via the "Customize page" Palette button in the event workspace (`event-page-dialog.tsx`, gradient/accent swatches + preview link); the workspace's "Ticket page" copy button hands out the event URL (other kinds still copy the wizard URL). 404s unless kind=event + active + public_bookable + property-slug match.
- **Public booking page** (migration 0068): `/book/<property-slug>` — middleware-allowlisted wizard (warm guest palette, one decision per screen like the forms wizard): service → date/party/duration → live slots → details → done. Web bookings land **pending** (`source:'web'`), are rate-limited per IP (`publicRateLimit`), and trigger a confirmation email (`lib/bookings/email.ts`, Resend fail-soft) carrying a **signed manage link** — `/book/manage/<token>` (HMAC per `lib/bookings/manage-token.ts`; guests get signed deep links, NOT Supabase magic links — those are staff-only) where they view status and self-cancel (emits `booking.cancelled`). Per-service `public_bookable` toggle in the service dialog; "Public page" copy button in the Bookings header. Public API: `/api/guest/book/[propertySlug]` (GET availability / POST create) + `/api/guest/book/manage/[token]` (POST cancel).
- **Booking questions — Forms × Bookings** (migration 0069): a published form attaches to a service via **`schedule.formId`** (picker in the service dialog); guests answer while booking on both public surfaces (wizard details step + event-page registration card) via the warm-palette `components/public-booking/guest-form-fields.tsx` renderer (guest-safe subset: sourced selects + file fields are filtered server-side by `lib/bookings/booking-form.ts:loadBookingForm`). The guest POST validates answers BEFORE creating the booking (422 + per-field `fieldErrors`, no slot burned), then writes a `form_responses` row (source **`'booking'`** — 0069 widened the CHECK; `respondent_id` null, `_booking_reference` inside answers) and appends a `summarizeAnswers` one-liner to the booking notes so staff see answers on every agenda/door surface. **The guest chatbot collects them conversationally too**: `check_availability` surfaces `booking_questions` (field ids + options) so the bot knows to ask; `create_booking` takes a `form_answers` map, runs `coerceBookingAnswers` (forgiving: option labels→ids, "yes"/"no"→bool, numeric strings) then the same validate → on missing-required it returns `needs_answers` + the questions so the model re-asks (the web 422 loop, conversationally), and on success writes the same response row + notes via the shared `recordBookingFormResponse`. All in `lib/bookings/booking-form.ts`; smoke-covered.
- **Demo data**: `node --env-file=.env.local --no-network-family-autoselection scripts/seed-bookings-demo.mjs` — re-runnable; 14-table restaurant (4 zones) + spa + kayak tour + a one-off beach party (17/120 tickets) + a 3-unit car rental (incl. a 24h van hire), ~40 bookings across yesterday→+5d covering every status/source. Agenda view opens with a 4-stat engine-pulse strip.
- Deferred: table combinations + reflow, server sections, meal-stage statuses, drag-on-timetable (menu-move shipped instead), reminders/no-show automation, waitlists, deposits/payments, per-party-size turn times, multiple ranges per day in the hours editor, bookings lens in Insights metrics, reserved-seat event ticketing (GA-capacity covers small venues per research).

## Forms & onboarding — one schema, four surfaces

The Forms feature and the setup wizard share one persisted form definition: `lib/forms/schema.ts` (`FormSchema`, versioned JSON in `forms.schema`, migration 0057). We deliberately did NOT adopt `@json-render` for storage — it's pre-1.0 with breaking spec churn; we own the schema, AI fills it via `generateObject`-style `Output.object`. One renderer (`components/forms/form-renderer.tsx`, page + one-question-per-screen wizard modes; `FormFieldInput` exported for custom shells) serves every surface:

- **Forms section** — `/p/[propertyId]/forms` (Home rail): list, dnd-kit builder with live preview, responses table + per-field summaries, settings (publish/close, allow-multiple, anonymous). AI generation: `/api/properties/[propertyId]/forms/generate` (Haiku, label-only schema → server-assigned field ids); AI editing in the builder via `/forms/[formId]/edit` (propose-then-apply — the model returns the full revised field list, kept `id`s preserve answer keys; `AiEditPopover` in `form-builder-extras.tsx`). Actions in `components/forms/actions.ts`.
- **Data-connected options** — choice fields can carry `field.source` (`members|projects|tasks|spaces|labels|sheet_column`, `FormFieldSourceZod`) instead of a static options list; options resolve live via `/api/properties/[propertyId]/forms/options` + `lib/forms/resolve-options.ts` (sheet columns read the `documents.sheet_state` first-sheet snapshot: header row = column labels, cell value === option id === label). Answers store record ids; labels resolve server-side for workflow payloads (`fields[].formatted`) and the responses API (`sourcedLabels`). Builder UI: `SourcePicker` in `form-builder-extras.tsx`.
- **Chat** — share a published form into a channel (`components/forms/share-form-dialog.tsx` → `shareFormToChat`); travels as a custom Stream attachment `{type:"form", form_id, property_id, title, description?, field_count}` rendered by `SlackAttachment` → `FormAttachmentCard` (fill-in-place dialog, source `"chat"`).
- **Workflows** — `form.submitted` trigger fires from `submitFormResponse` via `emitWorkflowEvent` (payload: answers + labeled `fields` list); `action.form.send` step (surface "forms", runner `lib/workflows/runners/forms.ts`) posts the same attachment as the bot.
- **Pins** — forms pin to space overviews alongside docs (migration 0058 generalized `space_pinned_resources`: surrogate PK, `document_id`/`form_id` check; `pinFormToSpace` in `components/forms/share-actions.ts`).

**Onboarding** (`app/onboarding`) is a full-screen Claude-style wizard (cream canvas, serif questions, chips, Enter-to-advance): name → type/size → departments → role/priorities → invites → AI build. `/api/onboarding/plan` (Haiku, deterministic fallback in `lib/onboarding/plan.ts` keyed by property type) proposes spaces/channels/labels/starter form; `createWorkspace` in `app/onboarding/actions.ts` seeds it all (property+membership fatal, everything else fail-soft) and stores answers in `property_profiles` (0057) so bots can be property-aware. Welcome page shares the visual language.

**Adding a new in-app bot:** create `lib/ai/bots/<name>-bot.ts` with a persona + scoped tool set, call `runBot()` from `lib/ai/run-bot.ts`. Don't reinvent prompt assembly, model settings, or tool wiring — the runtime handles it (gbrain tools and `delegate_to_openclaw` are auto-injected; activation-reason handling, deferral-guard, temperature/stopWhen settings are uniform across bots). Wire your bot to a Next.js API route and a client component on its surface.

## Document editor — Notion-style blocks

The Tiptap document editor (`components/documents/document-editor.tsx`) supports a Notion-style block palette. Every block is reorderable via a hover drag handle (`tiptap-extension-global-drag-handle` — see `components/documents/document-drag-handle.css`). Block schema is protected by `enableContentCheck: true` + `onContentError` so old docs survive schema additions.

Current block set (slash `/` to insert):
- **Basic** — H1/H2/H3, bulleted/numbered/to-do list, quote, divider, **code block with syntax highlighting** (lowlight + github-dark theme).
- **Blocks** — sub-page, **table** (native, resizable), **callout** (5 tones + emoji icon), **toggle** (collapsible, open-state synced via Yjs), **chart** (bar/line/area/pie via recharts with an editable data grid).
- **Media** — image (paste/drop), **file/PDF attachment** (uploaded to Supabase `documents-files` bucket via `/api/documents/files/upload`), **embed** (YouTube/Vimeo/Loom/Figma/Twitter/Spotify/CodePen with og:meta bookmark fallback via `/api/documents/og-preview` — detection in `lib/documents/url-embeds.ts`), **spreadsheet** (Google Sheets / Excel Online iframe).

Custom node implementations live in `lib/documents/nodes/`; their React views live in `components/documents/nodes/`. When adding a new node type, also:
1. Register it in the GlobalDragHandle `customNodes` array in `document-editor.tsx` so the drag handle picks it up.
2. Add a slash-menu entry in `components/documents/slash-command.tsx` with a `section` field.
3. If the bot should be able to author it, extend `ALLOWED_TAGS` + `ATTR_ALLOWLIST` in `lib/ai/bots/doc-bot.ts` and update the `propose_document_content` tool description.

## Agents section — user-built internal agents on the eve runtime (built 2026-07-17)

The **Agents** rail section (`/p/[propertyId]/agents`, More menu) lets staff
create, inspect, and chat with configurable internal AI agents, plus see a
read-only transparency gallery of every built-in bot (`lib/agents/builtin.ts`
— keep it honest when adding bots). Architecture:

- **Data**: migration 0073 — `agents` (versioned `config` jsonb per
  `packages/agent-config`: instructions, modelTier standard|advanced
  (Haiku/Sonnet), tool grants, SKILL.md-format skills, document resources,
  starter prompts) + `agent_sessions` (eve session id ↔ agent/user, holds the
  continuation token; RLS: personal). Config schema is shared with the
  runtime via `@hotelclaw/agent-config` (zod-only workspace package;
  `lib/agents/schema.ts` re-exports it).
- **Runtime**: `apps/agent` (eve, see root CLAUDE.md for the isolation
  rules). Per-session resolution via eve `defineDynamic`: channel auth
  stamps `propertyId`/`role`/`agentId` attributes →
  `agent/lib/agent-config.ts:resolveSessionAgent` loads the row →
  instructions (`agent/instructions/dynamic.ts`), model (`agent/agent.ts`),
  tools (`agent/tools/catalog.ts` — executors for `AGENT_TOOL_CATALOG`, ids
  must stay in sync; every `execute` INLINE per eve's replay constraint;
  every query scoped by the stamped propertyId, never RLS), skills
  (`agent/skills/dynamic.ts`). Paused/archived agents resolve to null →
  static fallback instructions, no tools.
- **UI**: `components/agents/*` — gallery (`agents-list.tsx`), editor
  (`agent-editor.tsx` — the whole config in plain sight), chat
  (`agent-chat.tsx` — talks to `/eve/v1/*` same-origin with property/agent
  headers; NDJSON stream replays from index 0 so the transcript is rebuilt
  from the event log each attach, which makes resume free; tool calls render
  inline with expandable payloads). Server actions in
  `components/agents/actions.ts`. Section is server-rendered → rail
  pushState exception (`AGENTS_ROUTE`), and `/agents` is matched in
  `sectionFromPath`.
- **Verify changes** by driving the real loop: with `EVE_DEV=1 pnpm dev`
  running (Node 24), create a session via `POST /eve/v1/session` with the
  service bearer + `x-hotelclaw-{property,user,agent}` headers and stream
  it; check persona, tool calls, and tenant scoping. Agent-file edits are
  NOT reliably hot-reloaded — restart the dev server after changing
  `apps/agent/agent/*`.
- **Not yet done**: production deploy of the eve service (Vercel build
  output + Node 24 runtime + coexistence of eve's workflow routes with the
  app's own `withWorkflow` — verify before first deploy), production
  channel-auth hardening (drop `localDev()`), approval-gated write tools,
  schedules, session-list UI (rows are recorded already).

## Tier 2 — OpenClaw (separate service, not in this repo)

One persistent agent handles long-running, scheduled, cross-channel, or skill-heavy work. **Not provisioned yet** — `delegate_to_openclaw` currently runs as a logging stub (`lib/ai/tools/delegate.ts`). Once `OPENCLAW_API_URL` is set, the tool flips to live HTTP delegation without code change.

**When to delegate to OpenClaw instead of building a Tier 1 bot:**
- The task lives longer than a single request (monitoring, watching)
- It's scheduled / recurring (daily standup, weekly reports)
- It spans surfaces (read from Stream, send via SMS, write to calendar)
- It needs the OpenClaw Skills ecosystem (5,400+ skills via Composio)

## Substrate — gbrain (shared brain via MCP)

All bots — Tier 1 + Tier 2 — read/write the same memory pool through gbrain's MCP server. Per-property: each property has its own gbrain process backed by its own Postgres database (gbrain models tenants as "brains" = databases). The MCP client is per-property; `getGbrainClient(propertyId)` returns a connection scoped to that property's brain, so **tenant isolation lives at the connection/brain layer, not in tool args**. `runBot()` discovers gbrain's tool surface via `client.tools()` and merges it into every bot's tool map.

**Primary tools** (gbrain exposes ~30; these are the ones the bot picks between):
- `search` — cheap hybrid retrieval (vector + BM25). Use for raw matches.
- `think` — LLM-synthesized answer with citations + gap analysis. Use for hard questions; more expensive.
- `capture` — write an observation/signal into the brain. Use to record durable insights the team or other bots should benefit from.

**Hosting** — per-property gbrain + OpenClaw processes on a shared Supabase Postgres cluster (one DB per property) is the target deployment. Provisioning is deferred. Today, `GBRAIN_MCP_URL` + `GBRAIN_MCP_TOKEN` env vars act as a single shared-instance fallback for dev/staging integration testing. When unset, `getGbrainClient()` returns null and bots run without gbrain tools (fail-soft). The same pattern applies to `OPENCLAW_API_URL` + `OPENCLAW_API_TOKEN`. See `lib/ai/gbrain-config.ts` and `lib/ai/openclaw-config.ts` for the resolution chain.

## The boundary in one sentence

> If the response can be generated in a single turn and lives within one surface, it's Tier 1 (build a bot). If it needs to live longer than a request, span surfaces, schedule, or use external skills, it's Tier 2 (delegate to OpenClaw).
