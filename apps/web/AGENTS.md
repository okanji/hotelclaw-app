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
# The UI is gr8r-studio's (port started 2026-10-29) — read before building UI

The user owns gr8r-studio (`github.com/gr8rstudio/gr8r-studio`, plain-JS) and
adopted its design wholesale: gr8r's look, OUR functionality (never drop a
feature; where gr8r has no place for it, build it in gr8r's style). Plan +
progress log: `~/.claude/plans/gr8r-ui-port.md`.

- **CSS = gr8r's own files, verbatim.** `styles/gr8r/*.css` is copied from
  gr8r's `src/styles`; `node scripts/build-gr8r-css.mjs` compiles them to
  `app/gr8r.css` (GENERATED — never edit): every selector scoped under `.g8`,
  every custom property renamed `--x` → `--g8-x` (so gr8r's `--accent` /
  `--border` don't collide with our shadcn tokens), `:root[data-theme=dark]` →
  `.dark .g8` (next-themes), all in `@layer components` so Tailwind utilities
  still win. Hand-written additions (where our markup differs — a Link where
  gr8r has a <button>) go in `app/gr8r-ext.css`. The property shell root
  (`app/p/[propertyId]/layout.tsx`) carries `g8`; anything portaled out of it
  that should look gr8r (the mobile drawer) adds `g8` itself.
- **Write gr8r's class names in JSX** (`page`, `ph`, `panel`, `sitem`, `btn
  btn-secondary btn-sm`, `ibtn`, `av`, `prog`…) — check they exist in
  `styles/gr8r`. Per-element parameters use the renamed names:
  `style={{"--g8-c": …}}`, `--g8-p`, `--g8-sz`, `--g8-cols` (bare `--c` etc. is
  aliased in gr8r-ext.css as a safety net). Icons: `Gi`
  (`components/gr8r/icon.tsx`) = the Lucide glyph gr8r's `ic('name')` names,
  stroke 1.8, class `i`. Shared glyph helpers: `components/gr8r/*-glyphs.tsx`
  (StIcon, PrIcon, Av, AvStack, ProgBar, PStatus, G8_COLOR).
- **Shell.** Sidebar = gr8r's `renderSidebar` (`components/shell/gr8r-sidebar.tsx`):
  `.ws` property switcher › Home, Inbox (`/activity`, accent count), My Tasks
  (due today/overdue count), Favorites (Notifications folded into Inbox — `/notifications`
  redirects to `/activity`, the topbar bell opens `?view=unread`), then our Chat, Docs,
  Forms (right under Docs) › WORKSPACE (Overview, Projects, Tasks, Calendar,
  Timeline, Members, Cycles, then **More** — the workspace Activity feed is
  an Inbox tab, `/activity?view=workspace`; Triage is part of Tasks,
  Linear-style: a Triage row under each team, `/triage?team=`, + a "N in
  triage" chip on the Tasks board). **No BUILD group** (2026-10-29): More is
  the restored app-launcher grid (`components/shell/more-launcher.tsx`, every
  `NAV_APPS` tile grouped Work / Build & automate / Admin, a pin on apps with
  their own row) and is the ONLY way to Meetings, Workflows, Chatbots,
  Agents, Insights, Initiatives, Org chart ›
  PROJECTS (`.sproj`: tile, status dot, hover … menu + chevron, Board / List /
  Timeline / Docs → `?tab=` aliases in project-detail; completed hidden;
  Archive) › TEAMS (each expands to its lists → `/tasks?list=`) › `.side-bot`
  Help, Settings, account. Chat, Docs, Assistant and Forms are gr8r `.sproj`
  tree nodes: a hover chevron, and the section's OWN navigation (the old
  `components/shell/sections/*` bodies — channels + DMs, the docs tree,
  assistant projects, form list…) in a `.sub` beneath,
  open while you're in that section (`SItem` `body` in gr8r-sidebar.tsx;
  mounted only while open). Collapse keeps the ORIGINAL behaviour (user preference over gr8r's 52px
  rail, 2026-10-29): a ClickUp-style « in the sidebar header, invisible until
  the pointer is over the sidebar, hides the sidebar fully; a fixed » "Open
  sidebar" at the content's top-left brings it back (topbars pad for it via
  `md:[body:not(:has([data-sidebar-open]))_&]:pl-11`); ⌘\ or `[` toggle. Topbar = `PageHeader` rendered as gr8r's
  `.topbar` (crumbs, `.topsearch` → ⌘K palette, bell, `New ▾`). ≤640px: gr8r's
  `.bottomnav` (in `mobile-top-bar.tsx`). Appearance prefs (accent / density
  / motion, Settings → Appearance) are `data-*` on the `.g8` root via
  `<AppearancePrefs />`.
- **Pages ported** (`components/gr8r/*`): Home (`home-overview`), Inbox
  (`inbox-view`, two-pane; task rows embed TaskRoom ≥1280),
  My Tasks (`my-tasks-view`: Blocked / Overdue / Today / Upcoming / Completed,
  drag-to-reschedule, Replies owed + Waiting on others), `/favorites` (gr8r's
  page: Projects as `.pgrid` cards + Tasks as `.mini` rows, then ours —
  Docs, Teams, Forms, Channels; tasks = `task_favorites` (0119), the rest =
  `favorites` (0120, per user, realtime; `lib/favorites/use-favorites.ts`,
  `FavoriteStar` on each header + project menus + an amber `FavMark` on
  starred project cards / sidebar rows; doc "pins" are document favorites,
  v1 localStorage pins import once)), `/overview`, `/timeline`
  (workspace Gantt over our reschedule actions), Projects (Grid default /
  List / Table / Board / Timeline), Archive, Search, `/members` (+
  `/members/<id>` profile, Teams tab), team page (`teams-detail`), workspace
  Activity (`ws-activity-view`), `/settings?sec=` (`settings-*`). New pages
  Phase 5: Tasks board (`board.tsx` + `board-toolbar.tsx`: gr8r `.ph` /
  `.toolbar` / `.chipsbar`, view `.seg`, columns + cards + list on gr8r
  classes), the project page (`components/gr8r/project-*.tsx`: Overview ·
  Board · List · Timeline · Calendar · Docs · Activity — Docs is docs AND
  files in one tab (`project-files.tsx`, `?tab=files` aliases it): the
  project's linked docs (New doc creates one linked, Add docs, × unlinks),
  files uploaded onto the project (gr8r's Upload + `.dropzone` + `.upl`
  progress over `project_files` + the private `project-files` bucket, 0121,
  50 MB/file, XHR to Storage REST for real progress; uploader or
  owner/manager removes) and the project's task attachments), Calendar
  (gr8r month grid; our hourly time grid kept for Week/Day, `.tg-*` in
  gr8r-ext.css), the overlay primitives (`components/ui/*` restyled to
  gr8r's overlays.css numbers — they portal outside `.g8`, so they use
  Tailwind over our remapped tokens; a portal that wants gr8r classes adds
  `g8 g8-port`), and the **task drawer**: `useOpenTask` opens tasks in
  `components/gr8r/task-drawer.tsx` via `?task=<id>` on the current URL
  (mounted in the property layout; Esc / X close, expand → centred full,
  "Open as page" → `/tasks/<id>`; not on `/triage`, where `?task=` is the
  selection, nor on a task page, where navigation stays a page hop).
  TaskDetail itself is gr8r's drawer markup on all three hosts (page,
  embedded, artifact panel).
  Phase 6 (our surfaces, built in gr8r's idiom): Chat (channel header = the
  gr8r topbar; Stream DOM skinned in `stream-chat-overrides.css` ".g8 gr8r
  skin" block; bot cards `.g8-chat-card`), Docs (Files-view home with grid /
  list, `.topbar` doc chrome, `g8-doc` typography) + Forms, Assistant /
  Agents / Fleet / Memory (`components/gr8r/ai-glyphs.tsx`), Meetings
  staff side (`badge-glyphs.tsx`), Workflows + Chatbots staff
  side, Insights / Org / Triage / Cycles / Initiatives
  (`components/insights/g8-insights.tsx`, `ins-*` in gr8r-ext.css), auth /
  onboarding / errors (`components/auth/auth-shell.tsx` carries its own
  `.g8` root — those routes sit outside the property shell; `FullState`
  takes a rendered icon element from server pages). Phase 7: team page tab
  bodies, calendar event details, search excerpts (`.g8-snip`), route
  skeletons (`components/gr8r/route-skeleton.tsx`), channel header ≤900px
  folds into a "…" menu; gr8r's ≤900px off-canvas `.side` rule is
  neutralised inside our sidebar slot (our shell owns the mobile drawer).
  Guest-world pages
  (`/g/<slug>`, widget) keep the warm-cream palette. New pages
  are normal routes that render only while the URL is theirs — wrap the
  view in `<RouteGate segment="…">` (`components/gr8r/route-gate.tsx`, or
  `useSurfacePathname()` as favorites / members / overview / settings do).
  Persistent surfaces navigate by `pushState`, which never unmounts the
  current route page, so an ungated page keeps painting above them (the
  "split screen" bug on /notifications, /search, /archive, 2026-10-29) (they sit beside
  the persistent section surfaces). Guests may open `/activity`,
  `/notifications`, `/favorites` (`GUEST_SECTIONS`).
- Nav data that still applies: `NAV_APPS` / `useNavPrefs` (Settings → Sidebar
  shows/hides Teams / Projects), `use-section-navigation.ts` (last-path
  resume for Inbox / Chat / Docs / Assistant), `SERVER_RENDERED`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI bot end-to-end testing — use this before reporting AI changes done

When working on anything that touches the in-channel AI bot — `lib/stream/ai-*.ts`, `lib/ai/*.ts`, `app/api/stream/webhook/message-new/route.ts`, `app/api/stream/ai/*`, `components/chat/info-panel/ai-tab.tsx` — **run the bot test harness before claiming the change works**. Unit tests don't exercise the webhook → classifier → generateText → Stream-post pipeline; this harness does.

```bash
# Full functional coverage (all 4 modes: mention / auto / always / engaged)
node --env-file=.env.local scripts/bot-chat-test.mjs suite

# Auto + engaged JUDGEMENT (what the suite doesn't cover): unmentioned
# follow-ups, the named-human skip rule, threads, spinoff, re-engagement.
# Every assertion quotes the classifier's own reason when it fails.
node --env-file=.env.local scripts/bot-chat-test.mjs modes

# Stress (thread reply, 6-turn engaged with tool-history persistence, rapid-fire)
node --env-file=.env.local scripts/bot-chat-test.mjs stress

# One-off probe
node --env-file=.env.local scripts/bot-chat-test.mjs send \
  --mode engaged --mention --message "@hotelclaw what's blocked?"

# Inspect / clear current channel state
node --env-file=.env.local scripts/bot-chat-test.mjs state
node --env-file=.env.local scripts/bot-chat-test.mjs reset
```

## Capability suite — is the ANSWER right, and did the write LAND?

`bot-chat-test` proves the bot FIRES (modes, classifier, queue, delivery). It
says nothing about answer quality or whether a requested write happened.
`scripts/bot-capability-test.mjs` asserts outcomes, and is the one to run
when you touch the tool catalog, the knowledge ladder, or the persona.

```bash
# Everything (knowledge + actions). ~15-25 min: each turn is a real eve turn.
node --env-file=.env.local --no-network-family-autoselection \
  scripts/bot-capability-test.mjs

node ... scripts/bot-capability-test.mjs knowledge    # retrieval + honesty only
node ... scripts/bot-capability-test.mjs actions      # writes only
node ... scripts/bot-capability-test.mjs --only knowledge/two-part
node ... scripts/bot-capability-test.mjs --coverage   # which grants are untested
node ... scripts/bot-capability-test.mjs --sweep      # delete leftover CAPTEST rows
```

- **knowledge** scenarios are graded by an LLM judge that is handed GROUND
  TRUTH loaded from Postgres, so it grades against facts, not plausibility.
  Deterministic checks run first; the judge can only ADD failures.
  `knowledge/absent` is the anti-hallucination test — it asks about an SOP
  that does not exist and the only passing answer is "I can't find one".
- **action** scenarios verify the ROW, never the bot's claim of success.
- Fixtures carry a `CAPTEST` marker; cleanup runs automatically, and
  `--sweep` clears leftovers from a crashed run.
- It runs against **whatever the Stream webhook points at** — prod by
  default, so no ngrok needed (`configure-stream-webhook.mjs status`).
  Corollary: a scenario for a tool that exists in this repo but has NOT been
  deployed will fail, and the failure is about the deploy, not the code.

  > **`action/list-channels` is expected to FAIL until `apps/agent` ships.**
  > `list_channels` was added 2026-08-07 to close the gap this suite found
  > (`post_to_channel` was granted but nothing could turn a channel name into
  > an id). It is written, granted, capability-mapped, drift-guards pass, and
  > it builds — but production predates it, so the bot correctly answers
  > "I have no channel directory". Re-run `--only action/list-channels`
  > after the next deploy; nothing else needs to change.
- **Writing a scenario — three ways the harness lied before the bot did.**
  Every one of these produced a red result against a bot that was correct:
  1. *Incomplete ground truth invents hallucinations.* A doc whose record
     title is "Untitled document" has a BODY titled "SOP: Walk-in Freezer…";
     grading against record titles alone marks the right answer as fabricated.
     `realDocuments()` supplies title AND content heading.
  2. *The answer is not always the message text.* `render_ui` puts tables and
     lists in an `ai_ui` ATTACHMENT — the text just says "titles below".
     Always grade `gradeableText(message)`, never `message.text`.
  3. *The bot writes Unicode.* "−18 °C" uses U+2212, not an ASCII hyphen, so
     `/-18/` misses it. `gradeableText` normalises dashes; keep regexes loose.
  4. *Five tools are APPROVAL-GATED* (`archive_document`, `delete_task`,
     `cancel_meeting`, `send_notification`, `post_to_channel`). They park for sign-off instead of executing, so
     asserting an immediate row fails a correct bot. Set `approvalGated: true`
     — the runner then asserts the park FIRED, replies "approve", and only
     then checks the row. A startup drift guard warns on the mismatch.
  5. *Beware the false pass.* `post_to_channel` "passed" while never running:
     asked to post to the CURRENT channel the bot correctly answers "my reply
     already is a message here", and a text assertion matches that. Test a
     relay into a DIFFERENT channel, and verify in the target.

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
- **Channel bot** — `lib/stream/ai-reply.ts` (built — auto mode's classifier (`lib/stream/ai-auto-classifier.ts`) has two sensitivity-independent ALWAYS-respond rules: the message continues a conversation with the bot, or it asks for something on the bot's capability list. **Both are schema fields answered before the verdict and then ENFORCED IN CODE** (2026-08-03): asked for one boolean, Haiku would name the rule and decline anyway ("rule A applies, but I already answered that"), so every auto-mode follow-up silently needed a fresh @-mention. The capability list rule B is judged against lives in `lib/stream/ai-capability-map.ts` and is drift-guarded against the runtime's real grants — a tool the blurb doesn't advertise is a thing auto mode won't volunteer. Replies can carry **rich UI** via the `render_ui` tool (`lib/ai/tools/render-ui.ts`): the model emits a @json-render spec over the house catalog in `lib/ai/chat-ui/catalog.ts` (Stack / DataTable / CardGrid / Card / StatRow / Stat — zod-validated + size-capped server-side), posted as Stream attachment `{type:"ai_ui", spec}` and rendered by `components/chat/ai-ui-attachment.tsx` (json-render's `Renderer` MUST be wrapped in `JSONUIProvider` even for static specs). **Deep links**: the model attaches entity refs (`Card.link` / `DataTable.rowLinks` = `{kind: task|project|document|meeting|form|space, id}` — ids come from tool results, which return `id` for this purpose), and the tool validates each id against the property (batched per kind) and rewrites refs into `/p/<pid>/<section>/<id>` hrefs before the spec is stored; the stored-spec `href` fields must match `INTERNAL_HREF_RX`, so nothing external/scripted can render. Clickable rows/cards navigate via next/link. @json-render is pinned exact (pre-1.0 churn); we deliberately don't use `catalog.prompt()` — the compact tool description in the catalog file is the model's manual. Markdown tables that still slip through get fallback styling in `app/stream-chat-overrides.css`.)
  **Generative UI (2026-10-26):** the catalog grew three interactive
  elements, documented to the model in `CHAT_UI_TOOL_DESCRIPTION` and drawn
  by `components/chat/ai-ui-generative.tsx` (web) / `apps/mobile/components/
  attachments/AiUiGenerative.tsx` (phone): **Chart** (bar / line / area /
  pie over the documents' chart data model — recharts on the web, svg on the
  phone, the `--series-*` ramp), **Form** (an inline chat form over the
  house Field / Input / NativeSelect / Checkbox — the AI SDK "generative UI"
  idea: the model asks for several details at once) and **Questionnaire**
  (the shadcn/ui Questionnaire primitive, `components/ui/questionnaire.tsx`:
  one question per step, choices, optional free text, progress, letter
  shortcuts). Both forms submit through the surface's `ChatUiSendProvider`
  as the person's OWN next message in the fixed `formatFormSubmission`
  shape ("Title — answers:" then "- label: value" lines) and settle to one
  "answers sent" line, so the model reads answers back from the transcript
  and a form never renders live twice. **Artifacts outside the channel:**
  the Assistant / Agents / fleet transcripts and the phone's `EveTranscript`
  derive `app_artifact` cards from write-tool RESULTS
  (`artifactsFromToolCalls` in `@hotelclaw/chat-ui/turn` — create/update/
  rename document, sheet cells, create/update task → `ArtifactCard`, which
  opens the split panel; a call still running shows as "writing").
- **Liveblocks comment bot** — `lib/ai/bot-scaffold.ts` (built — property-scoped replies run through `runBot()` (2026-07-19), so memory + delegate inject like every Tier-1 bot; only the no-property fallback stays a bare `generateText`)
- **Task detail bot** — `lib/ai/bots/task-bot.ts` + `app/api/properties/[propertyId]/tasks/[taskId]/ai/route.ts` + `components/tasks/task-ai-panel.tsx` (built)
- **Document bot** — `lib/ai/bots/doc-bot.ts` + `app/api/properties/[propertyId]/documents/[documentId]/ai/route.ts` + `components/documents/document-ai-panel.tsx` (built — Q&A + inline write via `propose_document_content`, with the bot's HTML output covering paragraph, headings, lists, blockquote, code, tables, callouts. Floating-toolbar inline rewrite is wired separately via Liveblocks's `AiToolbar` + the `resolveContextualPrompt` endpoint at `/api/properties/[propertyId]/documents/[documentId]/ai/contextual`.)
- **Calendar AI** — Liveblocks Copilot wired in `components/calendar/calendar-ai-panel.tsx` (built — uses Liveblocks's `AiChat` rather than `runBot()`, since it lives inside a Liveblocks room. The copilot is OURS as of 2026-07-20: `NEXT_PUBLIC_LIVEBLOCKS_COPILOT_ID` → "Hotelclaw Calendar", provider Anthropic claude-sonnet-4-6 with our API key, created via `Liveblocks.createAiCopilot` — generation still runs on Liveblocks' servers with that key. Memory access via the client-registered `search-property-memory` tool in `calendar-ai-tools.tsx` → member-gated `GET /api/properties/[propertyId]/memory`)
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
- **Runtime**: `lib/ai/guest-bot/run-guest-bot.ts` — `streamText`, deliberately NOT `runBot()` (guests are untrusted: no memory/delegate/property tools, injection-hardened prompt, Haiku/Sonnet per `config.modelTier`). Tools from `lib/ai/guest-bot/tools/registry.ts`, built ONLY from the bot's enabled actions, each with a Chatbase-style natural-language `whenToUse` appended to the tool description: `search_knowledge`, `save_guest_details`, `create_ticket` (→ `tasks` with `source:'ai'` + Stream channel card + `chatbot.order_created` event), `handoff_to_human` (`performGuestHandoff` — the status flip structurally mutes the bot, checked BEFORE generation; Stream card, `guest_escalation` notifications, `chatbot.escalated` event). Actions emit workflow events (`source:'chatbot'`, trigger catalog in `lib/workflows/catalog/chatbots.ts`).
- **Public surface**: `/g/[botSlug]` page (warm cream/serif, mobile-first, allowlisted in `lib/supabase/middleware.ts`) + `/api/guest/chatbots/[slug]/{session,messages}` — HMAC session tokens (`lib/chatbots/guest-session.ts`, localStorage Bearer; secret `CHATBOT_SESSION_SECRET`, falls back to `STREAM_API_SECRET`), layered Upstash rate limits + daily/session caps (`lib/chatbots/limits.ts`), plain-text streaming; non-generation outcomes are JSON `{state}` the client branches on by content-type; guests poll while escalated (no anon Realtime).
- **Builder**: `components/chatbots/*` — list, template gallery (`lib/chatbots/templates.ts`) + "describe it" AI draft (`/api/properties/[propertyId]/chatbots/generate`, Haiku `Output.object`), tabbed editor (Build / Knowledge / Conversations / Settings+Deploy with QR via `react-qr-code`) beside an always-on sandbox TestConsole (`.../test` route — real runtime, simulated side effects, live knowledge search; `.../train` chunks sources via `lib/chatbots/ingest.ts`). Staff reply surface: conversation page with Supabase Realtime + take-over / return-to-bot (`sendStaffReply`/`setConversationState` in `components/chatbots/actions.ts`).
- **Custom HTTP actions** (migration 0062, `chatbot_custom_actions`): staff define arbitrary HTTPS API calls the bot can make — Chatbase 4-step wizard in `components/chatbots/custom-actions-panel.tsx` (general → request → params → live test → response field allowlist). Executor `lib/chatbots/custom-actions.ts`: HTTPS-only with DNS-resolved private-IP SSRF guard, no redirects, 10s timeout, 20KB JSON-only responses, dot-path allowlist before the model sees data. Header values AES-256-GCM encrypted at rest (`lib/chatbots/crypto.ts`) and never returned to the client (only names). Tools named `custom_<slug>`; they run live even in the test console.
- **Widget embed**: `public/chatbot-widget.js` (script-tag → floating bubble → iframe of `/g/<slug>?embed=1`; same-origin inside the iframe so no CORS). Framing is locked by a per-bot `frame-ancestors` CSP set in `lib/supabase/middleware.ts` from `chatbots.allowed_domains` (empty = no embedding). The script path is allowlisted in `isPublic` (the root matcher only exempts image extensions).
- **Hybrid retrieval** (fail-soft): set `OPENAI_API_KEY` and retrain → chunks get `text-embedding-3-small` vectors (`lib/chatbots/embeddings.ts`) and `search_chatbot_chunks_hybrid` (RRF: vector + FTS, 0062) takes over in `retrieval.ts`; without the key everything stays FTS+OR-fallback.
- **WhatsApp/SMS**: per-bot `twilio_number` (Deploy tab) + one shared webhook `/api/guest/channels/twilio` — `To` routes to the bot, the guest's `From` IS the session token, channel `whatsapp|sms`. With `TWILIO_ACCOUNT_SID/AUTH_TOKEN` set, the webhook acks empty and replies via REST in `after()` (15s webhook timeout); without creds it replies synchronous TwiML (and skips signature validation with a warning). Staff replies from the conversation viewer push out via Twilio REST when configured (`lib/chatbots/twilio.ts`).
- **Feedback**: guests thumb bot replies (PATCH on the guest messages route → `chatbot_messages.feedback`); shown next to timestamps in the staff transcript.
- **Smoke test** (run before claiming guest-bot changes work): `node --env-file=.env.local --no-network-family-autoselection scripts/chatbot-smoke.mjs` — seeds a throwaway bot, exercises session → knowledge answer → custom action (live dummyjson call through the encrypted-header executor) → thumbs → widget/CSP → Twilio webhook → order→task → handoff → muting over real HTTP against the dev server, cleans up after itself.
- **In-channel deployment** (migration 0063, `chatbot_channel_deployments` — one bot per channel): resolved RUNTIME-SIDE on the eve session (2026-07-20 — the old web-side `resolveChannelDeployment`/`buildChannelDeploymentTools` merge is deleted): `channel-bot-eve.ts` sends the Stream channel id as `x-hotelclaw-channel`; `apps/agent/agent/lib/agent-config.ts:resolveSessionAgent` swaps in the custom bot's persona (staff-context preamble appended) + model tier, and `apps/agent/agent/tools/channel-deployment.ts` mounts its knowledge search + `custom_<slug>` HTTP actions on top of the catalog property tools. Deployed bots therefore get the durable session, property memory, and render_ui like the default bot. No deployment row → default channel bot unchanged. Picker lives in the Deploy tab (`setChannelDeployments` — which also resets the channel's eve session so persona changes apply immediately).
- **Analytics tab**: deterministic counts (orders, escalations, thumbs, 14-day volume from `chatbot_usage_daily`) + Haiku-labeled topic/sentiment cached on conversation rows (0063 columns, batch-classified lazily by `classifyConversations` in `lib/chatbots/analytics.ts` when the tab's GET route loads; ≤25/load, settled conversations only, ids validated). "Trending negative" badge on topics with ≥⅓ negative conversations.
- **Playground compare**: TestConsole → Compare opens `playground-dialog.tsx` — two synced panes sending the same message through the test route with per-pane `override` (modelTier/instructions/onlyFromSources, applied without saving).
- **Auto-retrain**: `/api/chatbots/auto-retrain` cron (04:30, vercel.json) — retrains bots whose document sources are older than the doc's `body_updated_at` or whose url sources are >24h stale.
- **Gotchas**: `/chatbots` must match before `/chat` in `sectionFromPath`; chatbots pages are server-rendered (rail pushState exception, like meetings); extension functions/types/operators need `extensions.` qualification in migrations (`extensions.gen_random_bytes`, `extensions.vector`, `operator(extensions.<=>)`).

## Bookings — REMOVED (2026-10-29)

The Bookings feature (bookable services, table/event/rental modes, the
staff agenda / floor plan / timetable, the public `/book/*` wizard + event
ticket pages + signed manage links, the chatbot `book_service` action, the
`booking.*` workflow triggers + `action.booking.*` steps, the calendar
booking source, the Home "Today's bookings" widget, the agent's
`list_bookings` / `create_booking` / `update_booking_status` tools and the
pod bots' `get_bookings` / `get_booking` / `refund_booking`) was deleted on
2026-10-29. **Code deleted, data kept, no migration**: `bookable_services`,
`service_resources`, `bookings` and the 0065–0069 columns stay in the
database, but nothing in the repo reads or writes them. Tolerant reads stay
for history — a saved chatbot config that still lists `book_service` parses
(unknown action types are dropped before validation, `lib/chatbots/schema.ts`),
old `booking_made` conversation outcomes and persisted booking chat cards
still render, and `form_responses` rows with source `'booking'` read like
any other response. Saved workflows that used a `booking.*` trigger or an
`action.booking.*` step no longer validate against the spec.

## Who did what — activity log, milestones, Gantt, deadlines (built 2026-10-23)

A side-by-side with the open-source gr8r-studio task manager (plain-JS demo,
`github.com/gr8rstudio/gr8r-studio`) surfaced four gaps; each is now closed.
Everything here lives behind **migration 0106** (`activity_log`,
`project_milestones`, `projects.lead_user_id`) — apply it before testing.

- **`activity_log` — the actor-aware change log.** `workflow_events` is the
  automation OUTBOX: DB triggers write it with no acting user and only for
  the events workflows can trigger on, so nothing could say *who* moved a
  task. `activity_log` is written by its own security-definer triggers on
  `tasks` / `projects` / `project_milestones` (one row per changed field:
  created, status_changed/completed/reopened, priority_changed,
  assigned/unassigned, due_changed, scheduled, renamed, description_changed,
  labels_changed, project_changed (+ `project_removed` stamped on the project
  it LEFT so both feeds see it), space_changed, parent_changed, deleted;
  projects: status/dates/lead/archived; milestones: added/completed/…). The
  actor is `auth.uid()`; a service-role write can hint one with
  `set local app.actor_id = '<uuid>'` / `app.actor_kind` (the eve runtime
  acts under a person's scope — wire the GUC there when bot attribution
  matters). Task INSERTs with `source = 'workflow' | 'ai'` are attributed to
  that engine. `entity_title` is a snapshot so rows read after deletion;
  `project_id`/`space_id` are denormalised so scoped feeds are one indexed
  filter. Member SELECT only; realtime-published.
  - Read via `lib/query/activity-log-queries.ts` (`activityLogQueryOptions`
    with a property / project / space / task / actor scope; `matchesFamily`
    is the one filter-chip mapping, tested in `lib/query/__tests__`).
  - Render via `components/activity/activity-log.tsx`: `describeActivity`
    turns a row into **Actor · verb · *object link* · extra** ("You" for the
    viewer, project/space/member names resolved from the shared caches),
    `ActivityLogFeed` (day buckets + kind chips + person select, realtime),
    `ActivityLogList` (compact rails), `useViewerId` (pages that don't carry
    the user id).
  - Surfaces: **Inbox → Activity** tab (`/activity?view=workspace`, property-wide,
    "in <project>" suffix), **project + space pages** (rail = last 6, a real
    *Activity* tab with filters — the trigger-based `activityQuery` feed is
    no longer used there), and the **task page** (`TaskHistory` — field
    changes above the Liveblocks comment threads; creation row excluded
    because the page already renders "Task created by X").
- **Project milestones + lead.** `project_milestones` (name + `due_date`
  day + `completed_at`, per project) with `components/projects/
  milestones-panel.tsx` (diamond per row — filled when reached, warning ink
  when overdue — inline add, one-click reach/unreach, realtime) on the
  project Overview; `projects.lead_user_id` with a `LeadPicker` row in the
  rail (`updateProject({ lead_user_id })`). Actions in `milestone-actions.ts`,
  queries in `lib/query/milestone-queries.ts` (project + property-wide with
  the project joined, archived projects excluded).
- **Gantt (`components/tasks/timeline-view.tsx`, rewritten).** The gr8r
  model on our data: a wide scrollable canvas widened to cover every dated
  task (no more fixed 4-week window / "off window" rows), **Weeks (32px/day)
  / Months (11px/day)** zoom, **group by status / assignee / none**, every
  dated task a **draggable bar** (scheduled window = its days; due-only = a
  one-day bar on the due date — the diamond now means *milestone* only),
  drag moves by whole days (`rescheduleTask` action: shifts the window AND
  a due date that travels with it; the right edge resizes a window),
  sub-issue **progress fill**, `task_relations.kind = 'blocks'` drawn as
  **dependency arrows** (`lib/query/task-dependency-queries.ts`; dashed in
  warning ink when the blocked task starts before its blocker ends), a
  **milestone lane** (`milestoneScope` prop: property-wide on the board,
  one project on the project page), today line + auto-scroll to today, one
  scroll container with a sticky left pane. The project page gained a
  **Timeline** tab mounting it over the project's tasks.
- **Recurring tasks (migration 0107).** `tasks.recurrence`
  (`daily|weekly|biweekly|monthly`) + `recurrence_of`. The roll-forward lives
  in `lib/tasks/mutations.ts:updateTaskFor` (the shared web + mobile write
  path): when a recurring task goes to `done`, the NEXT occurrence is
  inserted — same owner / team / project / labels / cadence, `due_at` pushed
  by one cadence via `nextOccurrence` (tested in `lib/tasks/__tests__/
  recurrence.test.ts`), no sub-issues, `recurrence_of` pointing back. Raw DB
  status writes (workflow runners) do NOT roll forward. UI: the "Repeat" chip
  in `task-detail-inline-properties.tsx`. `routines` (0082) remain the
  per-team recurring CHECKLISTS; this is for one repeating job with an owner.
- **Column menu actions** (`kanban-column.tsx`): "Mark all done" and "Sort
  by priority" — end-of-shift clears that run through the per-task actions
  (`updateTask` / `moveTask`) so notifications, recurrence and the activity
  log all fire. **`N`** anywhere inside a property opens `/tasks/new`
  (`command-palette-context.tsx`; bare key, never while typing) and the
  palette gained a "Create task" action.
- **Bearer-capable routes added for mobile:** `/api/me/notifications` (+
  `/mark-read`) and `tasks/[taskId]/suggestions` now resolve the caller via
  `resolveApiCaller` (the suggestions route was cookie-only, so the phone's
  triage cards silently 401'd). The single-task GET also returns the
  columns the phone needs (`created_by`, `scheduled_*`, `space_id`,
  `project_id`, `parent_id`, `recurrence`, `source`).
- **Home gained "Across the property"** (`workspace-activity-widget.tsx`,
  the last 8 `activity_log` rows); the projects table shows the **Lead**
  column and the projects tracking timeline draws **milestone diamonds**
  above each bar.
- **Calendar deadlines.** Due-only tasks never reached the calendar (the
  events endpoint returns scheduled blocks only; the "client-side due
  markers" the old comment promised didn't exist). `calendar-room.tsx` now
  synthesises an all-day `TaskEvent` (`due_only: true`, done tasks excluded)
  per due-only task in the query window: amber "Due" chips in month view
  (draggable — every month cell is a `calendar-month-day` droppable; dropping
  moves `due_at` keeping its time of day, and a rail chip dropped on a month
  cell gets a 9–10am block), the all-day band in week/day view, and the
  existing task details dialog on click. The `internal:tasks` source toggle
  hides them with the blocks.

## Linear-parity planning — triage, cycles, estimates, initiatives, updates (built 2026-10-25)

A walk through Linear's public demo (`linear.app/demo`) surfaced five gaps;
all ship behind **migrations 0111 + 0112** (applied). Every new task column is
nullable, so mobile and older builds are untouched. Sidebar (gr8r port,
2026-10-29): **Cycles** is a WORKSPACE row in `gr8r-sidebar.tsx`; **Triage**
is part of Tasks as in Linear — `/triage` (selection `?issue=`, filter
`?team=`), a Triage row + count under each team in the sidebar, a "N in
triage" chip on the Tasks board toolbar; the old `/activity?view=triage`
redirects there; **Initiatives** lives in BUILD › More.
All three routes are server-rendered → listed in `SERVER_RENDERED`
(`use-section-navigation.ts`); `sectionFromPath` maps triage/cycles → tasks,
initiatives → home.

- **Triage queue.** `tasks.triage_state` `pending|accepted|declined` (null =
  never triaged). `getTasks` returns only null/accepted, so pending and
  declined tasks never reach a board. Intake: guest-chatbot `create_ticket`
  (untrusted guests — staff vet them; the triage bot's suggestions run in
  `after()`) and `createTaskFor({ triage: true })` ("Create triage issue",
  `POST /api/properties/:id/triage`). Server half `lib/tasks/triage-queue.ts`:
  accept/decline are GUARDED updates on `triage_state = 'pending'` (two
  deciders can't both win → "Already triaged" / 409); accept applies team /
  assignee / priority / project overrides in the same update, tops the column,
  sends `task_assigned` via `emitTaskAssignmentNotifications` (nobody is told
  about a task still pending), and resolves pending `task_suggestions`. Pure
  half `lib/tasks/triage-logic.ts` (tested). UI = `/triage`
  (`components/triage/*`, header Tasks › Team › Triage; full members only): list + the real `TaskDetail` (embedded) with Accept
  (popover pre-filled from task + AI suggestion) / Decline (optional reason);
  keys `1`/`2`/`j`/`k`. NOT `TaskRoom` — it reads the `["tasks"]` cache, which
  excludes pending tasks; for the same reason `TaskRoom`'s not-found state asks
  the single-task route and links pending tasks to `/triage?task=`. Queries in
  `lib/query/triage-queries.ts` (`["triage", pid]`, `["triage-count", pid]`,
  `useTriageRealtime`). 0112 logs `triage_queued` for tasks INSERTED pending.
- **Cycles + estimates.** `cycles` (inclusive local-date windows numbered per
  property + team; `space_id` null = property-wide) and `cycle_settings` (one
  cadence per team). Tasks gained `estimate` (points; unestimated counts 1),
  `cycle_id`, `milestone_id`. **No cron:** `lib/cycles/ensure.ts:ensureCycles`
  runs on every cycles page load / API call — materialises current +
  `upcoming_count` cycles, closes ended ones, and (`auto_rollover`) moves
  not-done work to the current cycle via the service client (logged `system`);
  idempotent (23505 from a race is ignored). Pure logic + tests in
  `lib/cycles/{dates,plan,scope,burnup}.ts` (dates in `properties.timezone`;
  started = in_progress|blocked; capacity = avg completed of the last 3).
  **Burn-up is replayed, not stored** — `buildBurnup` undoes logged
  activity_log changes day by day, so rolled-over work still counts in its old
  cycle. UI `/cycles?space=` (timeline, current expanded), `/cycles/[id]`
  (by status + "Moved on", side panel with breakdowns), `/cycles/current`
  redirect; task strip chips Estimate / Cycle / Milestone
  (`components/cycles/task-planning-chips.tsx`); board Cycle filter. Gotcha:
  changing a cadence's length/start deletes EMPTY upcoming cycles so the new
  shape applies at once. Any member can edit cadences (RLS = members).
- **Initiatives.** `initiatives` (planned|active|completed, owner, lead team,
  target) grouping projects many-to-many (`initiative_projects`). Pages
  `/initiatives` (Active / Planned / All) and `/initiatives/[id]`;
  `components/initiatives/*`, `lib/query/initiative-queries.ts`. Health = the
  latest update's declared health, else the worst effective health of its
  open projects (`lib/initiatives/planning.ts`, tested).
- **Status updates.** `project_updates` (exactly one of project / initiative):
  a person's health call (on_track|at_risk|off_track) + note; author-only
  edit/delete via RLS; composer + feed `components/projects/project-updates.tsx`
  on both Overviews. Declared health sits beside the computed pace health
  ("(pace)"). Posting notifies the project lead + owners of linked initiatives
  (type `project_update`, renderer case in `notification-item.tsx`, inbox
  Reports filter).
- **Milestone progress.** % = done ÷ all tasks with that `milestone_id`
  (`milestones-panel.tsx`, timeline tooltips); manual reach/unreach unchanged.
  Project Overview gained a Progress block (scope / started / completed in
  points, per assignee).
- **Activity.** New verbs (`estimate_changed`, `cycle_changed`,
  `milestone_changed`, `triage_*`, `update_posted`, initiative verbs) render in
  `components/activity/activity-log.tsx`; `{kind: "entity", id}` scope reads
  one initiative's feed. Not wired yet: mobile screens, bot/catalog tools for
  these entities, workflow triggers.

## Lists + custom statuses — ClickUp parity, Phase 1 (migration 0114, applied 2026-10-26)

Temple Point's ClickUp has per-list status pipelines (Maintenance runs 21
stages); the plan is `~/.claude/plans/replicated-chasing-nygaard.md` and the
roles prep (`lib/auth/roles.ts`, `requireFullMember` / `requireManagement`,
the `lib/security/__tests__/guest-gates.test.ts` drift guard) is Phase 0.

- **Model.** `status_sets` → `statuses` (`category` is ClickUp's five:
  `open | unstarted | active | done | closed`, plus `is_blocked` on `active`
  rows; `color` is the EntityColor ramp; exactly one open + one closed per
  set, names unique per set) and `lists` (`space_id` null = property-level;
  `status_set_id` + `inherits_statuses`; one `is_default` per space /
  property). Tasks carry `list_id` + `status_id` (both NOT NULL) and
  `completed_at`. Every property has a "Default" set + a "General" list;
  every space gets a "Tasks" list by trigger (`spaces_sync_default_list_aiu`,
  archived together). `custom_fields.list_id` scopes a field to one list.
- **The strangler: `tasks.status` is now a PROJECTION.** The legacy
  `todo | in_progress | blocked | done` column is derived by
  `tasks_a_resolve_container_status_biu` (BEFORE I/U, sorts first) from the
  status row's category (`open/unstarted → todo`, `active → in_progress` or
  `blocked`, `done/closed → done`). Writes work in BOTH directions: a
  `status_id` write wins; a legacy `status: 'done'` write is resolved to the
  list's closed status (blocked → first blocked active, etc.); a `list_id`
  move remaps by category when the new list's set differs; a status id from
  another set is remapped, never rejected. The same trigger resolves a
  missing `list_id` (parent → space default → General) and keeps
  `space_id` ↔ `list_id` consistent (list move syncs the space; a space
  change re-homes to that space's default list). `completed_at` is stamped
  on entering done/closed and cleared on leaving — **use it, not
  `status = 'done'`, for "is finished" in SQL** (the overdue / reminder
  partial indexes already do; `search_tasks_keyword` returns
  `status_name, status_category, list_id`).
- **Side channels restated** (0114 rewrites the FULL bodies of the 0040 +
  0106 triggers — any later migration touching them must restate the whole
  function again): `task.status_changed` payload keeps `from`/`to` literals
  and adds `from/to_status_id`, `from/to_name`, `from/to_category`,
  `to_blocked`; new event `task.moved_to_list`. Activity verbs `completed`
  / `reopened` key on `completed_at`, `status_changed` detail carries names +
  categories, new verb `list_changed`.
- **Web.** `lib/tasks/statuses.ts` is the pure catalog: predicates
  **`isDone / isStarted / isBlocked / isNotStarted`** over
  `{status_category?, status_blocked?, status}` (fall back to the legacy
  literal for old caches / mobile rows — always use these, never
  `=== "done"` in new code), `statusForLegacy`, `remapForSet`,
  `resolveStatusInput` (uuid | name | legacy literal), `buildCatalog` and
  `columnsFor(catalog, listId)` — a single-list scope gets that list's
  statuses as columns, any multi-list scope the four category columns
  (`CATEGORY_COLUMNS`, ids = the legacy literals, so `moveTask({status})`
  keeps working through the resolver). A tripwire test parses the
  migration's `legacy_status_of` CASE against `CATEGORY_META`. Data:
  `GET /api/properties/:id/lists` → `{lists, statusSets, statuses}`
  (`lib/tasks/status-catalog.ts`), query `["status-catalog", pid]` in
  `lib/query/status-queries.ts` (`useStatusCatalog`, realtime on the three
  tables — a `statuses` change also invalidates `["tasks"]` because cards
  read the flattened `status_name` / `status_category` / `status_color` /
  `status_blocked` off the task row, which `getTasks` joins), prefetched by
  `tasks/layout.tsx`. `lib/tasks/mutations.ts` accepts `status` as a uuid OR
  a legacy literal and `listId` on create / update (property-fenced); the
  recurrence roll-forward keys on `completed_at` and the next occurrence
  inherits `list_id` with no status (→ the list's open status).
- **Verify**: `node --env-file=.env.local --no-network-family-autoselection
  scripts/lists-statuses-smoke.mjs` (31 assertions over the live DB
  contract: backfill invariants, both write directions, list ↔ space sync,
  a 7-status custom pipeline remap, activity / workflow payloads, the
  delete guard; hard-cleans) + `lib/tasks/__tests__/statuses.test.ts`.
- **Lists in the shell + the list board (PR 2).** (Since the gr8r port the
  sidebar shows lists as each TEAM's `.sub` children in `gr8r-sidebar.tsx`;
  the old Tasks-node Lists group is gone.) Originally: property-level
  lists, then each top-level team (sub-teams nested by `parent_space_id`,
  now on `spacesQueryOptions`) folding open to its lists + a "New list" row
  (`lists/create-list-dialog.tsx`); the Teams group appends the same list
  rows under each team's views. A row opens **`/tasks?list=<id>`**: the
  board filters to the list, the breadcrumb reads Tasks › Team › List, the
  header grows a settings gear + "…" (`lists/list-row-menu.tsx`: rename /
  colour / archive — archiving a list with open tasks asks where they go),
  and the columns become the list's pipeline (`columnsFor`). The kanban
  (`kanban-view.tsx` / `kanban-column.tsx`) takes columns as a
  `BoardColumns` prop with STRING ids: a drop writes the column id through
  `moveTask` (status uuid or legacy literal — `isUuid` picks the DB column),
  and the optimistic patch is `columnPatch` (legacy literal + status row
  fields together, or `columnOfTask` snaps the card back). Column pills use
  `COLUMN_HUE[color]`; "Mark all done" targets `doneTargetFor(board)`;
  "Automate this column" hands the workflow prefill the category's legacy
  literal. Every status picker (`StatusMenuContent`, list cells, task
  detail rail + inline strip, the create page, sub-issue creation) takes
  the task's pipeline from `useTaskStatusOptions(propertyId, list_id)` and
  renders the chip via `describeStatus` + `StatusIcon {category, blocked,
  color}` (the legacy `status` prop still works for old rows). The task
  rail has a **List** row (`setTaskList` in `components/projects/actions.ts`,
  property-fenced). The create page follows `?list=` → the team's default
  list → General, and a status not in the chosen list's pipeline snaps to
  its open status.
- **Status-set editor (PR 3).** `lists/list-settings-dialog.tsx` (gear in
  the list board header; General / Statuses / Danger): the **Statuses** tab
  shows where the pipeline comes from ("Using <team>'s statuses — shared by
  N lists", editing it edits all of them) with a **Use team statuses**
  switch: off = `forkListStatuses` (copies the set into one the list owns,
  tasks move to the copy at the same index), on = `inheritListStatuses`
  (back to `space_status_set` / the property default, tasks remapped by
  category, the orphaned set archived). Rows: drag to reorder
  (`reorderStatuses`, 1024-step ladder), inline rename, colour, category,
  Blocked switch on Active rows, delete (`deleteStatus` moves its tasks to
  `fallbackFor` — the closest remaining status; the only open / closed
  status can't go), "+ Add status" by category. All writes are
  **owner / manager** (`requireManagement` in `lists/status-actions.ts`;
  the dialog reads the role via `useMyRole` to disable the controls). The
  pure invariants live in `lib/tasks/status-set-rules.ts` (`validateSet`
  with friendly `problemMessage`s, `deleteBlocker`, `fallbackFor`,
  `forkPlan`, `remapPlan`, `ladder`, tested) and run before every write so
  a person never meets the unique-index error. A category change on a
  status re-touches its tasks' `status_id` so the resolver refreshes the
  legacy projection + `completed_at`.
- **The literal sweep (PR 4, 2026-10-27).** Every task-row check on the
  legacy literal now goes through the predicates (`lib/cycles/scope.ts`,
  `lib/initiatives/planning.ts`, `lib/insights/metrics.ts` — the open-work
  snapshot's `todo / in_progress / blocked` buckets are CATEGORY buckets via
  `OPEN_STATUS_MATCH` — My tasks, the home widgets, timeline / list / cells /
  calendar / command palette / space detail). Postgres "is finished" filters
  key on **`completed_at`** (`.is("completed_at", null)` for open work:
  cycle rollover, the overdue sweep, the workflow query step, the AI list
  tools, the agent's morning brief; teams-pulse reads throughput off
  `completed_at`). Workflow event payload comparisons (`payload->>'to'`)
  are DELIBERATELY still the legacy literals — `from` / `to` on
  `task.status_changed` are the stable projection and the only field older
  rows carry; `to_name` / `to_category` / `to_blocked` are the enrichment.
  Literal `status: "todo"` inserts are gone (workflow create step, the
  guest ticket, the Actions MCP, the agent + pod bots): no status on an
  insert means the list's open status. The legacy category columns, group
  keys and filter chips (`COLUMNS`, `STATUS_IDS`, `STATUS_ORDER`,
  `STATUS_BAR`, the mobile filter sheet) stay — across lists the four
  categories ARE the grouping.
- **Names everywhere (PR 5, 2026-10-27).** Server-side text → status:
  `lib/tasks/status-resolve.ts` (`statusPatchForTask(db, taskId, input)`
  → `{status_id}` for a uuid / name of the task's list, `{status}` for a
  legacy literal, or the valid names for the error message). Workflows:
  `action.task.update.status` is a **template string** resolved that way
  (the runner throws with the valid names on a miss); `action.task.query.
  status` values are categories; `task.status_changed` output + the ref
  picker expose `to_name / from_name / to_category / from_category /
  to_blocked`, and the new trigger **`task.moved_to_list`** (`from` / `to`
  list ids) is registered in `spec.ts` + `catalog/tasks.ts`. Activity log:
  `status_changed` / `reopened` render the detail's `to_name`, and the new
  `list_changed` verb ("moved … to the Maintenance requests list" — list
  names come from the status catalog, now on `ActivityLookup.lists`) sits
  in the Projects family. Agent catalog (`apps/agent/agent/tools/
  catalog.ts`): `list_open_tasks` returns `status` = the list's status
  NAME + `status_category` + `list`, filters by category and by `list`
  name; `create_task` takes `list` (scoped to `team`) + `status` (a name of
  that list's pipeline; misses return the valid names); `update_task`
  takes `status` as a NAME of the task's list (legacy literals still map)
  and `list` to move it (resolved first, so a status in the same call is
  looked up in the destination). Pod bots + the operations subagent return
  `status_ref` names. The untyped agent client infers to-one embeds as
  arrays — normalise with `Array.isArray(ref) ? ref[0] : ref` inline (eve
  executors can't share a helper). Web `lib/ai/tools.ts` and the Actions
  MCP `list_tasks` return `status_name` too. The single-task GET flattens
  the status row like `getTasks` (mobile reads it). **Mobile**
  (`apps/mobile/lib/statuses.ts` — the phone's twin: predicates, `legacyOf`,
  `ENTITY_HEX`, `statusHexOf`, `useStatusCatalog(propertyId)` over
  `GET …/lists`): `ApiTask` grew the optional 0114 fields; task detail's
  Status section shows the task's LIST pipeline (chips by status name +
  colour, the list name as the section caption; a tap PATCHes the status
  uuid) and falls back to the four legacy chips until the catalog loads;
  the Tasks tab glyph is shaped by category and tinted by the status
  colour; the activity feed reads `to_name`.
- **Leftovers closed (2026-10-29).** The board's Status facet
  (`board-filters.tsx`) offers the four categories under "Any list" (legacy
  literals) THEN one group per status SET in use, headed by the list that
  runs it ("Default · 4 lists" when shared); a set stage's value is the
  status uuid, matched against `task.status_id` (`isUuid` picks). `Option`
  grew `group`, which `ValuePicker` renders as headings. The team page's
  Tasks tab (`TasksPanel` in `projects/workspace-panels.tsx`, `lists` prop)
  shows a chip per list of the team ("All · N", "Maintenance requests · 4");
  one list selected groups by THAT list's pipeline and offers "Open board"
  (`/tasks?list=`). Still open: the agent-runtime drift test for
  `status_category` in the catalog.

## Multiple assignees — ClickUp parity, Phase 2 (migration 0115, applied 2026-10-29)

- **Model.** `task_assignees(task_id, user_id, property_id, position,
  created_by, created_at)`, PK (task, user); member RLS with an insert check
  that the task is in the row's property and the person is a member;
  realtime-published. **`tasks.assignee_id` stays as the derived PRIMARY**
  (lowest position, then oldest) so every legacy reader — escalation ladder,
  REST/mobile contract, insights' event lens, the AI tools — keeps working.
- **Two-way sync, write ONE table per statement.** A write to
  `tasks.assignee_id` (createTaskFor's primary, recurrence, workflow runners,
  AI `assignee_name`, triage accept, mobile PATCH `assigneeId`) is mirrored
  into the set by `tasks_sync_assignee_set`: INSERT seeds the row, NULL
  clears the set, X replaces the old primary (X goes first, others stay).
  A write to `task_assignees` recomputes the primary
  (`task_assignees_sync_primary`). The hop back is silenced by the
  transaction-local GUC `hotelclaw.assignee_sync` — NOT `pg_trigger_depth()`,
  so a task inserted by an RPC/trigger still mirrors.
- **One activity row + one workflow event per PERSON**, from
  `task_assignees_log_and_emit`: `assigned {from:null,to,user_id}` /
  `unassigned {from,to:null,user_id}`; `task.assigned` (per person added) and
  the NEW **`task.unassigned`** (per person removed), both carrying
  `assignee_ids` (everyone on it now). The seed row for a task INSERT is
  silent (GUC `hotelclaw.assignee_seed`) — creation is the `created` row +
  `task.created`, as before. A task delete cascades without logging. 0115
  restates the full bodies of `tasks_emit_workflow_events` +
  `tasks_log_activity` (0114 minus their assignee branches) — a later
  migration touching them restates again. Renderers: unassigned reads
  "removed <person> from <task>" (web + mobile `lib/activity.ts`).
- **Write path** (`lib/tasks/mutations.ts`): `assigneeIds` (max 20, primary
  first) on create / update / triage accept — wins over `assigneeId`, which
  keeps "set the primary" semantics. `writeAssigneeSet` upserts the set
  (positions = order) then deletes the removed; it writes ONLY the set table.
  A set-only update reads the row instead of sending an empty PATCH
  (PostgREST rejects it — "Cannot coerce the result to a single JSON
  object", caught in the browser). Notifications: `emitTaskAssignmentNotifications`
  takes `{previousAssigneeIds, nextAssigneeIds}` and sends one
  `task_assigned` / `task_unassigned` per person who joined / left, never the
  actor. Recurrence copies the whole set.
- **Read path.** `getTasks` + the single-task GET embed
  `task_assignees(user_id, position, created_at)` → `assignee_ids` (primary
  first). Readers go through `lib/tasks/assignees.ts` — **`taskAssigneeIds(t)`**
  (falls back to `[assignee_id]` for old caches) and **`isAssignedTo(t, id)`**;
  never `t.assignee_id === me` in new code. Converted: My tasks lens, the
  board's Mine cut + assignee facet (Unassigned = empty set), workload
  (a shared task's hours land on EACH assignee's row; the day total counts
  it once), insights person lens + per-person open counts in `metrics.ts` (done-by-week
  stays keyed on the event's primary — history has no per-person split),
  catch-up "assigned to you" (`payload.to`). Group-by-assignee surfaces
  (timeline, grouped kanban) still group by the primary.
- **UI.** `components/tasks/assignee-stack.tsx` (`AssigneeStack`: overlapping
  avatars, "+N" past `max`, dashed unassigned glyph) on cards and list cells;
  cards resolve the non-primary people through `AssigneesMapProvider`
  (`lib/tasks/use-assignees.ts`; the board provides its one batched lookup).
  `AssigneeMenuContent` has a multi mode (`selectedIds` + `onChange`):
  checkbox rows that keep the menu open, ticked people first, "Primary" tag,
  "Unassigned" clears. Used by the task rail + inline strip (label
  "Ana +2" via `lib/tasks/assignee-label.ts`; the rail's icon slot is one
  avatar wide, so it shows the primary only — a stack there clipped the
  name), the list cell, and the create page. The board subscribes to
  `task_assignees` realtime and invalidates `["tasks", pid]`.
- **Workflows.** `action.task.assign` gained `mode: replace | add` (add =
  membership-fenced insert alongside the others). `task.unassigned` is
  registered in `spec.ts` / `catalog/tasks.ts` / `refs.ts`.
- **Agent.** `update_task` gained `assignees_add` / `assignees_remove`
  (names; one roster load per call, resolved by a closure local to the
  executor); `assignee_name` still sets the primary. `list_open_tasks`
  returns `assignees` (everyone) beside `assignee` (primary).
  `escalate_task` follows the primary.
- **Mobile.** `ApiTask.assignee_ids?` + `taskAssigneeIds` in `lib/api.ts`;
  the assignee facet and the Mine scope match any assignee; task detail's
  Assignees section toggles people (PATCH `assigneeIds`), the first is
  tagged "primary"; list rows read "Ana +1".
- **Verify**: `node --env-file=.env.local --no-network-family-autoselection
  scripts/clickup-parity-smoke.mjs assignees` (15 DB-contract assertions:
  silent seed, per-person log/emit, legacy replace keeps the rest, primary
  promotion, clear, cascade; hard-cleans) + `lib/tasks/__tests__/assignees.test.ts`.

## Custom field types + forms → fields — ClickUp parity, Phase 3 (migration 0116, applied 2026-10-29)

- **Types.** `custom_fields.type` adds `long_text, currency, url, email,
  phone, people, files, relation, progress` to the six (0080/0099), and
  `custom_fields.config` (jsonb): currency `{code, precision}`, people
  `{multiple}`, relation `{target_list_id}`. Value shapes: currency → number,
  people → member-id[], relation → task-id[], url/email/phone/long_text →
  string. **files is DERIVED**: `task_attachments.field_id` marks an upload as
  filling a named slot (Quote, LPO, GRN) and `task_attachments_sync_files_field`
  writes the attachment-id list into `task_field_values` (row dropped when
  empty). **progress is never stored** (computed from sub-issues + checklist
  counters at read time). `task_field_values_reject_computed` refuses direct
  writes to both (files only from inside the sync trigger, depth ≥ 2).
  The `task.field_changed` emitter (full 0101 body restated) labels people
  (names), relation (task titles), files (file names) and currency
  ("KES 1,251") in `to_label` / `to_labels`.
- **ONE write path.** `lib/tasks/field-coerce.ts` (pure, tested in
  `field-coerce.test.ts`) turns whatever a caller has — a typed UI value or
  free text from a workflow / the model / a form — into the stored value or
  a human error: loose amounts ("KES 12 000", "1,250.6") rounded to the
  field's precision, `https://` prefixed onto bare links (non-web schemes
  rejected), people by id / name / partial name, relation by key (GHV-12) or
  exact title (+ the target list), options by label, ISO timestamps → their
  day. `lib/tasks/field-write.ts:setTaskFieldValueFor(db, actorId, {propertyId,
  taskId, field: id|name, value})` loads only the lookups a type needs and
  fences property + team + LIST scope (the workflow runner used to skip the
  scope check). Callers: `setTaskFieldValue` (UI), `setTaskFieldRunner`
  (workflow set_field; a dry run coerces without writing), the internal route
  `POST /api/internal/tasks/[taskId]/fields` (service bearer — the AI tool),
  and the create-task runner's `fields`.
- **UI.** `components/tasks/field-type-icon.ts` is the one icon map
  (`TYPE_ICON` in the create form is an alias); `FIELD_TYPE_LABEL` /
  `FIELD_TYPE_ORDER` / `FIELD_TYPE_HINT` / `formatCurrency` /
  `formatFieldValue(field, value, ctx)` live in `lib/tasks/custom-field-options.ts`.
  The create form shows every type with a hint and per-type settings
  (currency code + decimals, "Allow several people", relation target list);
  suggestions now include Cost (KES money), Requester (one person), Quote and
  LPO (file slots). The manager row edits the currency code.
  `CustomFieldValueEditor` takes `context {propertyId, taskId}` and routes to
  `custom-field-rich-editors.tsx`: People (multi `AssigneeMenuContent` +
  `AssigneeStack`), Relation (task search, "Linked" group), Files (chips that
  open signed URLs, remove, Upload → `POST …/attachments?field=<id>` — the
  route checks the field is `files` and in the task's team / list), Progress
  (bar + "3/7"), and `ValidatedTextEditor` for money / url / email / phone /
  long text (validated with the SAME `coerceFieldValue`, links clickable,
  money formatted). Slot files are filtered OUT of the loose attachments list
  (they render in their field). The sidebar Fields section honours list-scoped
  fields. List columns: currency sums/averages format in the field's currency;
  the board filter gained a people facet for people fields.
- **AI.** `list_custom_fields` (definitions + one task's values as labels)
  and `set_task_field {task_id, field, value}` (→ the internal route, so the
  model's text goes through the shared coercion). Registered in all four
  places (`packages/agent-config`, channel bot + assistant grants,
  `ai-capability-map.ts` + blurb, `TOOL_LABELS` in `@hotelclaw/chat-ui/turn`).
  Verified live: "set Cost to 15,000 and add Smoke Tester" → `set_task_field`
  + `update_task {assignees_add}`.
- **Forms → fields.** `FormFieldZod.taskField` (a custom-field id);
  `lib/forms/field-mapping.ts` `FORM_TO_FIELD_COMPATIBLE` decides what the
  builder offers ("Save to a task field" in `form-field-panel.tsx`: short
  text → text/url/email/phone, number → number/money, select → dropdown by
  LABEL, yes/no → checkbox, people → people, file → files…).
  `computeTaskProperties` adds `fields: {fieldId: answer}` (choice answers as
  labels, yes/no as booleans, file answers as the upload list) and the
  `form.submitted` output schema lists it. `buildFormTaskAutomationSpec`
  emits `fields: {id: "{{trigger.task_properties.fields.<id>}}"}` (whole-value
  refs keep arrays intact; `extractFormTaskAutomationConfig` still treats it
  as the panel's simple shape). `action.task.create` gained
  `config.fields` (id or name → value); the runner writes each through
  `setTaskFieldValueFor` and COPIES a file answer from `form-uploads` into
  `task-attachments/{property}/{task}/…` with `field_id` (download +
  re-upload fallback). Per-field failures come back as `field_errors` on the
  step output — never thrown, the task survives. The task-automation card
  lists "question → Field (Type)" chips and warns when a team-scoped field
  won't apply to the automation's team.
- **Verify**: `scripts/clickup-parity-smoke.mjs fields` (needs `pnpm dev`):
  computed types refuse writes, slot upload derives the value + event label,
  the internal route coerces money / people / relation keys / urls and
  refuses bad values, and a "Run now" workflow with `fields` writes money and
  copies a form upload into a slot (23 checks). Unit:
  `field-coerce.test.ts`, `lib/forms/__tests__/{schema-logic,task-automation}.test.ts`.
- **Not done yet**: mobile has no custom-field editor (filters fall back to
  set / empty for the new types); there is no built-in Progress LIST column
  (a `progress` custom field shows it per task — sub-issues + checklists).

## Per-task checklists — ClickUp parity, Phase 4 (migration 0117, applied 2026-10-29)

- **Model.** `task_checklists(task_id, property_id, name, position)` and
  `task_checklist_items(checklist_id, task_id, property_id, parent_item_id,
  text ≤500, done, done_at, done_by, assignee_id, position, …)` — items nest
  ONE level inside the same checklist (`task_checklist_items_touch`, which
  also stamps `done_at` / `done_by` on a flip). Member RLS with the
  task/checklist/property consistency in `with check`; both realtime-published.
  `tasks.checklist_total / checklist_done` are trigger-maintained counters
  (`task_checklist_items_recount`) so cards, the Progress field and mobile
  read "3/7" off the row; `getTasks` + the single-task GET return them.
- **Quiet activity.** `checklist_added` / `checklist_removed` (one row per
  checklist) and `checklist_completed` when a tick closes the LAST open item
  of a checklist — plus the workflow event **`task.checklist_completed`**
  `{checklist_id, name, new}`. No per-tick rows. Verbs render on web
  (`activity-log.tsx`) and mobile (`lib/activity.ts`) and sit in the Status
  filter family.
- **Write paths.** `lib/tasks/checklist-write.ts:addChecklistItemsFor`
  (find-or-create a checklist BY NAME, append; two inserts total — top
  level, then sub-items) is shared by the panel's create, the workflow step
  and the AI. Pure helpers in `lib/tasks/checklist-progress.ts` (`nestItems`,
  `checklistCounts`, `progressFor`, `positionBetween`, `parseChecklistText`:
  one item per line, `- [x]` = done, an indented line nests — tested).
  Server actions in `components/tasks/checklist-actions.ts` (create / rename /
  delete checklist; add / update / delete item; the assignee is membership-
  checked).
- **UI.** `components/tasks/checklists-panel.tsx` under the sub-issues on the
  task page: per checklist a header (click to rename, "3/7", progress bar,
  "…" → Rename / Check all / Delete), dnd-kit reorder of top-level items,
  rows with checkbox + click-to-edit text + optional assignee avatar + "…"
  (Assign, Make a sub-item / Move out a level, Delete). Keyboard: Enter
  saves and opens a "New item" row right below (an untouched one removes
  itself on blur), Tab / Shift-Tab nest / un-nest, Backspace on empty
  deletes, Escape SAVES and leaves (it used to discard what you typed). Data:
  `lib/query/checklist-queries.ts` (`["task-checklists", taskId]`, kept out of
  task-detail-meta so a tick doesn't re-sign attachment URLs) +
  `useTaskChecklistsRealtime` (also refreshes `["tasks", pid]` for card
  counters). **Optimistic ticks carry a pending-write counter**: a patch
  cancels in-flight fetches and the refetch waits for the last write — rapid
  ticking once let a stale refetch untick an item on screen while the DB was
  right. Board cards show a `ListChecks 3/7` chip (green when complete).
- **Workflows.** Trigger `task.checklist_completed`; action
  `action.task.add_checklist {task_id, name, items}` (items = text, parsed
  like a paste; appends to a same-named checklist) — spec, catalog,
  field-defs, refs, author hint, runner (`addChecklistRunner`).
- **AI.** `add_checklist_items {task_id, checklist_name, items[]}` and
  `check_checklist_item {task_id, item_text, done}` (direct service writes —
  the triggers do the rest). Registered in all four places. Verified live;
  the model ran add + tick IN PARALLEL and reported a stale "1 of 5", so the
  tick tool's description now says to add first and wait.
- **Mobile.** `apps/mobile/components/TaskChecklists.tsx` on task detail:
  each checklist with its count, tap to tick, nested rows indented, "Add an
  item" — RLS reads/writes + realtime (no API route: no app-side effects).
- **Verify**: `scripts/clickup-parity-smoke.mjs checklists` (counters,
  nesting guard, completion logs + emits once and again on a real
  re-completion, delete zeroes counters, and a "Run now" add-checklist
  workflow that parses ticks + nesting and appends on a second run — 16
  checks) + `lib/tasks/__tests__/checklist-progress.test.ts`.
- **Deferred**: checklist templates per list ("Task Prep" auto-attached to
  every new task in a list) — today that is a workflow:
  `task.created` (filtered to the list) → `action.task.add_checklist`.

## Roles + guest access — ClickUp parity, Phase 5 (migration 0118, applied 2026-10-29)

Guests are outside collaborators (contractors, agencies, wedding couples)
who see ONLY what was shared with them. Role ladder: `lib/auth/roles.ts`
(`owner | manager | staff | guest`; `isFullMember`, `canManage`, `isGuest`).

- **The inversion (G3) — read this before writing a policy or a gate.**
  `is_member(prop)` now means FULL member (owner / manager / staff).
  `has_property_access(prop)` is the old "any membership row" meaning.
  Every policy that says `is_member` denies guests automatically, so **a new
  table that copies the usual `is_member(property_id)` policy is guest-safe
  by default** — only opt a table INTO guest access on purpose. Helpers
  (security definer, stable): `member_role`, `is_management`,
  `has_scope(prop, kind, id, need_edit)`, `can_access_space / _list / _task
  / _document / _channel`, `task_in_scope(prop, id, parent, list, space,
  need_edit)` (the row form the tasks policies call). Inheritance =
  ClickUp: a team covers its sub-teams, lists, tasks, docs and channels; a
  list its tasks; a task itself + its sub-issues; a doc its child docs.
- **Grants**: `member_scopes(property_id, user_id, scope_kind
  space|list|task|document|channel, scope_id, can_edit, granted_by)` — FK to
  the membership (removing the person drops their grants); RLS = read own or
  management, write management AND only onto `role = 'guest'` rows;
  realtime-published. `invites.scopes` carries a guest invite's grants
  until accept.
- **Opted-in tables** (0118 rewrote these with `ALTER POLICY` + extra
  SELECT policies — no drops): read for any role: `properties`,
  `memberships` (the member DIRECTORY is visible to guests — accepted
  leak: names on shared tasks), `labels`, `statuses`, `status_sets`, own
  prefs / views / columns (guests can't publish shared views). Scoped:
  `spaces` / `space_members` / `space_labels` / `lists` (select via
  `can_access_*`; writes stay `is_member`), `chat_channels` select, scoped
  `custom_fields` select, `tasks` (select = in scope; insert = created_by
  self + EDIT grant; update USING + WITH CHECK in scope with edit, so a
  guest can't move a task out of what they were given; delete = full
  members only), every per-task child table (`task_links`,
  `task_relations` (both ends), `task_document_links`, `task_attachments`,
  `task_description_revisions`, `task_field_values`, `task_assignees`,
  `task_checklists`, `task_checklist_items`: read with access, write with
  EDIT access), `documents` select / update (insert stays full-member),
  `document_labels` select, `activity_log` (task rows the guest can see),
  and the `task-attachments` storage bucket (folder `{property}/{task}/…`).
  Everything else (projects, cycles, initiatives, insights, workflows,
  agents, assistant, chatbots, forms, meetings, routines,
  entities…) denies guests with no edit.
- **Server gates.** `/api/*` bypasses the middleware, so routes gate
  themselves:
  - `getMembershipForProperty` now FAILS CLOSED for guests (≈65 callers use
    it before service-client work); `getPropertyAccess` is the explicit
    any-role read for the few guest-friendly paths (task attachments upload
    checks `can_access_task(…, need_edit)` for guests). `requireFullMember`
    / `requireManagement` sit on every service-client property route;
    `lib/security/__tests__/guest-gates.test.ts` has an EMPTY baseline now —
    a new ungated service-client route under `/api/properties/[id]` fails
    the test. Bearer (mobile) routes use `callerIsFullMember` from
    `lib/auth/api-caller.ts` (task AI, triage); the members route still
    lists the directory for guests but never returns emails to them.
  - Middleware: a guest's `/p/<pid>/<section>` must be in `GUEST_SECTIONS`
    (tasks, my-tasks, documents, chat, dms, threads, inbox, spaces) — any
    other section redirects to `/my-tasks`. Fail-closed: a NEW section is
    hidden from guests until added on purpose.
  - eve: `verifyMembership` in `apps/agent/agent/channels/eve.ts` returns
    null for guests, so every authenticator refuses them (drift-guarded).
    In DEV the chain ends in `localDev()`, which admits any call WITHOUT
    property scope — not a leak, but don't read a 202 as "guest allowed".
  - Channel bot: the webhook skips guest senders, and both acting-principal
    lookups in `channel-bot-eve.ts` refuse a guest instead of falling
    through to the OWNER principal (that fallback would have handed a guest
    owner-level tools).
  - Liveblocks auth: guests never get the `property:<pid>:*` wildcard —
    only granted task / doc rooms (FULL with an edit grant, READ without);
    boards / calendar / workflow rooms 403; a private
    `property:<pid>:guest:<uid>` room covers the no-room call.
- **Guest lifecycle.** `createInvite` takes `role: "guest"` + `scopes`
  (validated to the property by `lib/guests/scopes.ts:validateScopes`;
  `GUEST_ROLE_ENABLED=false` turns guest invites off). `acceptInvite` gives
  a guest no home team / manager / org position, writes the grants, and
  `syncGuestChannels` puts them in ONLY the Stream channels of what was
  shared (upserting the Stream user first). Management actions in
  `lib/guests/actions.ts` (`listGuestGrants`, `grantGuestScope`,
  `revokeGuestScope`, `setGuestScopeEdit`, `listShareTargets`) re-sync
  channels on every change.
- **UI.** Invite dialog: a Guest role card + `GuestScopePicker`
  (`components/members/guest-scope-picker.tsx`: teams / lists / documents as
  chips, one Can edit switch). Members dialog: guests carry a Guest badge
  and an **Access** button → `GuestAccessDialog` (grants with per-grant Can
  edit + remove, and "Share more"). Shell for a guest: no create menu, no
  Assistant, a "Shared with you → Tasks" row instead of the app launcher,
  no Projects group (Teams shows only granted teams via RLS). Mobile:
  `PropertyMembership.role` includes guest; the Assistant entry points hide.
- **Verify**: `node --env-file=.env.local --no-network-family-autoselection
  scripts/guest-smoke.mjs` — signs in a real STAFF user and a real GUEST
  (the service client would bypass RLS) and asserts: staff regression;
  a grant-less guest sees the property + directory and nothing else;
  read / edit / task grants show exactly the right tasks, lists, checklists
  and activity; read-only can't write; edit can't move a task out of scope;
  guests never delete; the helper RPCs agree; and over HTTP (needs `pnpm
  dev`): middleware redirect, every guest page renders without leaking the
  unshared team's task, the tasks API returns only shared work, Liveblocks
  room grants, the workflows API returns nothing (49 checks). If guest
  pages 500 with "No QueryClient set" alongside "Yjs was already imported",
  the dev bundler has duplicated modules after many hot reloads — restart
  `pnpm dev` (and clear `.next/dev`); it is not an app bug.
- **Not done / needs a decision**: Stream's `team` channel type still lets
  any signed-in user QUERY a property's public channels directly (the
  app scopes the list client-side) — restricting reads to channel members
  is a Stream dashboard permission change; until then a technically minded
  guest could read public channels outside their grants. No "Share with
  guests" button on team / list / task / doc pages yet (grants are managed
  from People → Access); task and channel grants are created only through
  the API / invite scopes; a channel created later inside a shared team
  reaches the guest at their next grant change (no create-time sync);
  `/api/stream/ai/start` still lets a channel member (incl. a guest) add
  the bot to a shared channel (the bot then ignores guest messages).

## Page audit vs Linear (2026-10-25) — controls on the page, detail-page parity

- **One page header everywhere — Linear's compact bar.** Every page opens
  with `PageHeader` (`components/shell/page-header.tsx`: h-11, title + icon or
  breadcrumbs left, actions right) plus an optional `PageHeaderRow` for view
  tabs / filters; no `SectionHeader size="page"` mastheads, no ledes (DESIGN.md
  § Page header). My tasks' Assigned / Created lists fill the pane and scroll
  inside `ListView`'s own container (no `-mx-*` bleed, which clipped the last
  column).
- **Page controls live on the page, never only in a sidebar body** (the tree
  hides bodies of collapsed rows). Calendar toolbar owns Day / Week / Month /
  **Year** (keys D/W/M/Y) and a Calendars popover (`calendar-sources-menu.tsx`:
  source toggles, accounts, connect, the 5-min external re-sync); Year view is
  `year-grid.tsx` (density dots from the same filtered feed); all per-view math
  (range, paging with day clamping, density) is `lib/calendar/view-range.ts`
  (tested, `never` checks on every view switch). Inbox header owns the view
  tabs, a view-scoped Mark all as read and per-row Mark read; task
  notifications open in an embedded split pane at ≥1280px (mark-UNREAD is not
  supported by the API yet). Insights mounts `ScopeSwitcher` in its header.
  Sidebar bodies of these apps hold shortcuts only.
- **My tasks** tabs `?tab=focus|assigned|created|activity` are pure lenses
  (`lib/tasks/my-tasks-lens.ts`) over the shared tasks cache rendered with the
  board's `ListView` (shares the board's saved column layout). Memoize lens
  rows — and `ListView`'s query fallbacks are module constants — because a
  fresh array per render loops its order effect ("Maximum update depth").
- **Meetings lifecycle is derived, not stored** — `lib/meetings/status.ts`
  (pure, tested) decides Upcoming / Live / Past and the past outcome (summary
  ready / summarizing / summary failed / transcript failed / processing ≤1h /
  no transcript / no call). Scheduled rows' `started_at` is the DB default, so
  never use it for scheduled meetings; walk-up calls without `ended_at` stop
  being Live after 6h. Schedule = the calendar `EventDialog`; Start =
  `useMeeting().start({channelId})`; Join = `startScheduled`. No re-summarize
  route yet (`raw_jsonl` is stored, so one is feasible).
- **Task detail**: the right rail is the single home of properties at
  ≥`@4xl/task` (container query on TaskDetail's root); below that, or
  `variant="embedded"`, the inline strip shows and the rail opens as a drawer.
  Planning rows = `TaskPlanningChips variant="row"`. Header prev/next + `k`/`j`
  use `lib/tasks/task-sequence.ts` (board order — the board's toolbar
  filters/sort are local state, not followed).
- **Project Overview** has ONE Progress block (points + per-status tally); the
  inline row holds live state (Status, Health), the rail holds attributes.
  **Team rail** has "Go to" (Triage `?team=`, Tasks `?space=`, Cycles) and
  "Sub-teams" (`parent_space_id`).
- Every full page load still waits on the Stream connection
  (`lib/stream/client-provider.tsx`), now behind a shell-shaped placeholder;
  rendering the shell before Stream connects is the real fix (pending).

## Automations everywhere — the lightning button (built 2026-08-14)

Every feature page that a workflow can read from or act on carries a **⚡ Automations button** in its header, so automation is discovered from the surface you're standing on rather than only from the Workflows section.

- **The lens** — `lib/workflows/features.ts` (client-safe, pure catalog metadata). An `AutomationFeature` is NOT a catalog `Surface`: surfaces include plumbing buckets (`ai`/`control`/`system`/`external`), and `chatbot.*` triggers are filed under `external` next to webhooks. So each feature declares the surfaces it claims **plus** optional id prefixes, and `workflowTouchesFeature()` matches a workflow's trigger + step ids against both. `featureRole()` splits "starts here" (trigger) from "ends up here" (action) — the modal labels the difference. Deliberately generous: one extra row beats hiding the one the user opened the modal to find. Drift-guarded in `lib/workflows/__tests__/features.test.ts` (every feature matches ≥1 real catalog entry; no two features claim the same surface).
- **The data** — `GET /api/properties/:propertyId/workflows` returns `step_types` alongside `trigger_event_type`, so the lens runs client-side off the SHARED workflows list query with no new endpoint and no spec fetch. The modal's on/off switches write through that same cache, so toggling here and in the Workflows section stay consistent.
- **The UI** — `components/workflows/automations-button.tsx` (`<AutomationsButton propertyId feature="docs" />`; `variant="toolbar"` (default) for the compact `PageHeader` and dense toolbars, `variant="outline"` for in-page section headers; count badge = enabled workflows touching the feature) mounts `automations-dialog.tsx` ONLY once clicked, so an unclicked button costs nothing and never triggers a model call. Wired into tasks board toolbar, chat channel header, documents home, meetings, calendar, forms, chatbots.
- **Suggestions** — `POST /api/properties/:propertyId/workflows/suggestions` (Haiku + `Output.object`). The model proposes plain-English GOALS, **never specs**: the goal is handed to the existing author copilot at `/workflows/new?prefill=`, which owns catalog discovery and validation, so a bad suggestion can at worst waste one copilot turn — it can never smuggle an invented trigger id into a saved workflow. **Four grounding layers**, in order of how much they constrain the answer:
  1. **Deterministic signals** — `lib/workflows/suggestion-signals.ts`, one gather per feature, returning `{id, signal, evidence}` lines describing the property's REAL state ("3 tasks are blocked — 50% of open work", "8 documents haven't been edited in 90+ days"). **No model in the number path**: Tasks reuses `computeInsightsMetrics` / `computeTrendSignals` / `detectAnomalies` (the same functions the dashboards chart) rather than a second, quietly-diverging definition of "overdue"; the rest are bounded SQL. Every gather is `safe()`-wrapped and fail-soft. Each feature also gets a trimmed set of companion signals (most automations start in one surface and end in Tasks or Chat). `GATHERS` is a `Record<AutomationFeature, …>` so exhaustiveness is a compile-time guarantee — no drift test needed.
  2. **The catalog** — the exact triggers/actions the feature supports, so the model can't propose what the engine can't build.
  3. **property memory** — institutional memory (`memoryContextLines` over `agent_memories`), with the query **steered by the top deterministic signals** (search "blocked work" only when work is actually blocked). Same Postgres as the signals, so no timeout race; skipped on cache hits.
  4. **Industry prior** — hospitality-ops judgement in the system prompt, disciplined by 1–3.
  Suggestions cite signal ids in `basis`; the route **resolves those ids to the evidence lines server-side and drops anything the model invented**, so the "Suggested because" list in the UI is measured fact, not the model's account of its own reasoning (same handshake as the insights brief's `basis`). Redis-cached 24h against a fingerprint that **includes the signal digest**, so suggestions refresh when the property's situation changes rather than merely when time passes. Fail-soft throughout (no Redis ⇒ regenerate, no `ANTHROPIC_API_KEY` ⇒ section hides).
- **Suggestion length is clamped, never validated.** The `Suggestion` zod schema deliberately has NO `.max()` on title/why/goal — length guidance lives in the field descriptions and a server-side `clamp()`. The first live run produced three well-cited suggestions and threw all of them away on every retry because one `why` was 230 chars against a `max(200)`: in structured output a hard length cap turns a presentation nit into total generation failure.
- **Adding a surface**: add the feature to `AUTOMATION_FEATURES` + `FEATURES` in `features.ts`, then drop `<AutomationsButton>` in that page's header. Nothing else — the modal, count, and suggestions all derive from the catalog.
- **`?prefill=` is UTF-8-safe** as of this change: `builderPrefillHref()` base64s UTF-8 bytes and `decodePrefillGoal` reverses it (`btoa` throws on non-Latin1, so a suggestion title with an en dash used to break the link). ASCII payloads round-trip identically, so older prefill links still work.

## Workflows section vs Linear Loops (audited 2026-10-26)

Linear's automations are now **Loops** (`linear.app/demo/loops`): a "Create a
new loop" prompt box first, then a category-tabbed template gallery whose cards
read **Trigger → Action**; each loop has Run history, Run now (schedule /
manual-ish triggers, enabled loops only) and versions. What we took:

- **"What does it do?" in one line** — `lib/workflows/summary.ts`
  (`triggerLabel`, `primaryAction` = first non-`control.*` step + "+N",
  `canRunNow`, `runStatusLabel`; tested in `lib/workflows/__tests__/summary.test.ts`)
  rendered by `components/workflows/flow-summary.tsx` on list rows and template
  cards. Run logs + the run inspector show catalog labels, never raw
  `task.created` / `instant|durable`.
- **Run now** — `POST …/workflows/:id/run {runNow: true}`: only for
  `RUN_NOW_TRIGGERS` (manual.run / schedule.*), 409 while the workflow is off,
  runs synchronously via `runWorkflowNow` with the payload the real trigger
  would emit, returns the run id (UI opens it). In the builder header beside
  Test and in the list row menu. The legacy `{}` body still just emits a
  `manual.run` event.
- **List** — Mine lens (`created_by` now in the list API), row menu Run now /
  Turn on-off / Duplicate (`workflow-actions.tsx`, copy starts off) / Delete…
  behind a confirm dialog (delete = archive). Empty state is Linear's
  prompt-first creator → `builderPrefillHref` so the copilot owns the
  conversation. Builder page header links to the workflow's **Runs**.
- **Templates** — category tabs (`workflow_templates.category`).
- **Verify**: `node --env-file=.env.local --no-network-family-autoselection
  scripts/workflows-smoke.mjs` — ephemeral member, real cookie-authed routes:
  create → list fields → run-now gating → run succeeds + side effect lands →
  run log → duplicate → delete; hard-cleans after itself.

## Forms & onboarding — one schema, four surfaces

The Forms feature and the setup wizard share one persisted form definition: `lib/forms/schema.ts` (`FormSchema`, versioned JSON in `forms.schema`, migration 0057). We deliberately did NOT adopt `@json-render` for storage — it's pre-1.0 with breaking spec churn; we own the schema, AI fills it via `generateObject`-style `Output.object`. One renderer (`components/forms/form-renderer.tsx`, page + one-question-per-screen wizard modes; `FormFieldInput` exported for custom shells) serves every surface:

- **Forms section** — `/p/[propertyId]/forms` (**its own rail section in More as of 2026-08-11**, ClickUp-style hub: `ShellSection "forms"`, sidebar `components/shell/sections/forms-section.tsx` with All forms / New form / Draft with AI — the create entries deep-link `?new=1` / `?ai=1` which `FormsList` opens-then-strips — plus one row per form, kept live by Realtime on `forms` (migration 0100); the Documents sidebar keeps its convenience Forms group; `/forms` stays a rail pushState exception): list, dnd-kit builder with live preview, responses table + per-field summaries, settings (publish/close, allow-multiple, anonymous). AI generation: `/api/properties/[propertyId]/forms/generate` (Haiku, label-only schema → server-assigned field ids); AI editing in the builder via `/forms/[formId]/edit` (propose-then-apply — the model returns the full revised field list, kept `id`s preserve answer keys; `AiEditPopover` in `form-builder-extras.tsx`). Actions in `components/forms/actions.ts`.
- **"After submitting → create a task" panel** (ClickUp's form→task model, 2026-08-11) — on the form Settings tab (`components/forms/task-automation-card.tsx`): a write-through toggle + team/assignee/priority selects that manage a REAL workflow (`form.submitted` filtered to the form → single `action.task.create` step; first answer templated into the title, every answer into the description) via `components/forms/automation-actions.ts` + the pure spec builder/matchers in `lib/forms/task-automation.ts` (tests in `lib/forms/__tests__/task-automation.test.ts`, wired into vitest include). The automation is a normal workflow — visible in Workflows; if someone customizes it there (extra steps / templated ids) the panel flips read-only and links to the builder. The onboarding starter automation matches the same shape, so it appears in the panel too. Saving rebuilds the spec from the form's CURRENT field order (refs are positional `trigger.fields.N.formatted`) — re-save after reordering questions.
- **Data-connected options** — choice fields can carry `field.source` (`members|projects|tasks|spaces|labels|sheet_column`, `FormFieldSourceZod`) instead of a static options list; options resolve live via `/api/properties/[propertyId]/forms/options` + `lib/forms/resolve-options.ts` (sheet columns read the `documents.sheet_state` first-sheet snapshot: header row = column labels, cell value === option id === label). Answers store record ids; labels resolve server-side for workflow payloads (`fields[].formatted`) and the responses API (`sourcedLabels`). Builder UI: `SourcePicker` in `form-builder-extras.tsx`.
- **Chat** — share a published form into a channel (`components/forms/share-form-dialog.tsx` → `shareFormToChat`); travels as a custom Stream attachment `{type:"form", form_id, property_id, title, description?, field_count}` rendered by `SlackAttachment` → `FormAttachmentCard` (fill-in-place dialog, source `"chat"`).
- **Workflows** — `form.submitted` trigger fires from `submitFormResponse` via `emitWorkflowEvent` (payload: answers + labeled `fields` list); `action.form.send` step (surface "forms", runner `lib/workflows/runners/forms.ts`) posts the same attachment as the bot.
- **Pins** — forms pin to space overviews alongside docs (migration 0058 generalized `space_pinned_resources`: surrogate PK, `document_id`/`form_id` check; `pinFormToSpace` in `components/forms/share-actions.ts`).

**Onboarding** (`app/onboarding`) is a full-screen Claude-style wizard (cream canvas, serif questions, chips, Enter-to-advance): name → type/size → departments → role/priorities → invites → AI build. `/api/onboarding/plan` (Haiku, deterministic fallback in `lib/onboarding/plan.ts` keyed by property type) proposes spaces/channels/labels/starter form; `createWorkspace` in `app/onboarding/actions.ts` seeds it all (property+membership fatal, everything else fail-soft) and stores answers in `property_profiles` (0057) so bots can be property-aware. Welcome page shares the visual language.

**Adding a new in-app bot:** create `lib/ai/bots/<name>-bot.ts` with a persona + scoped tool set, call `runBot()` from `lib/ai/run-bot.ts`. Don't reinvent prompt assembly, model settings, or tool wiring — the runtime handles it (property-memory tools and `delegate_to_openclaw` are auto-injected; activation-reason handling, deferral-guard, temperature/stopWhen settings are uniform across bots). Wire your bot to a Next.js API route and a client component on its surface.

## Document editor — Notion-style blocks

The Tiptap document editor (`components/documents/document-editor.tsx`) supports a Notion-style block palette. Every block is reorderable via a hover drag handle (`tiptap-extension-global-drag-handle` — see `components/documents/document-drag-handle.css`). Block schema is protected by `enableContentCheck: true` + `onContentError` so old docs survive schema additions.

Current block set (slash `/` to insert):
- **Basic** — H1/H2/H3, bulleted/numbered/to-do list, quote, divider, **code block with syntax highlighting** (lowlight + github-dark theme).
- **Blocks** — sub-page, **table** (native, resizable), **callout** (5 tones + emoji icon), **toggle** (collapsible, open-state synced via Yjs), **chart** (bar/line/area/pie via recharts with an editable data grid).
- **Media** — image (paste/drop), **file/PDF attachment** (uploaded to Supabase `documents-files` bucket via `/api/documents/files/upload`), **embed** (YouTube/Vimeo/Loom/Figma/Twitter/Spotify/CodePen with og:meta bookmark fallback via `/api/documents/og-preview` — detection in `lib/documents/url-embeds.ts`), **spreadsheet** (Google Sheets / Excel Online iframe).

**Never write into an unsynced or empty Yjs doc from the client.** The
Liveblocks webhook persists every room update over the Postgres snapshot, so
a client-side seed into a room that lost its data WIPES the stored body
(happened 2026-10-29: a sync-timeout fallback seeded `<h1>title</h1>`). Rules
in `document-editor.tsx`: `initialContent` (applied only to an EMPTY room) is
the Postgres `body_json` snapshot when it has content, else the title; the
editor stays read-only (`setEditable(isReady)`) with a "Still connecting"
notice until Yjs has synced — no timeout fallback writes.

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
  static fallback instructions, no tools. Memory is NOT a grant (2026-10-23):
  the eve memory slots in `agent/memory/*` recall property memory + the
  person's notes into every property-scoped session and mount
  `property__remember/forget/search` and `person__…` automatically.
- **UI**: `components/agents/*` — gallery (`agents-list.tsx`), editor
  (`agent-editor.tsx` — the whole config in plain sight), chat
  (`agent-chat.tsx` — talks to `/eve/v1/*` same-origin with property/agent
  headers; NDJSON stream replays from index 0 so the transcript is rebuilt
  from the event log each attach, which makes resume free; tool calls render
  inline with expandable payloads). Server actions in
  `components/agents/actions.ts`. Section is server-rendered → rail
  pushState exception (`AGENTS_ROUTE`), and `/agents` is matched in
  `sectionFromPath`.
- **Verify changes** by driving the real loop: with `pnpm dev`
  running (Node 24), create a session via `POST /eve/v1/session` with the
  service bearer + `x-hotelclaw-{property,user,agent}` headers and stream
  it; check persona, tool calls, and tenant scoping. Agent-file edits are
  NOT reliably hot-reloaded — restart the dev server after changing
  `apps/agent/agent/*`.
- **Not yet done**: production deploy of the eve service (Vercel build
  output + Node 24 runtime + coexistence of eve's workflow routes with the
  app's own `withWorkflow` — verify before first deploy), production
  channel-auth hardening (drop `localDev()`).

## Assistant section — the personal AI surface (built 2026-08-14)

A **private, tabbed chat over the whole workspace**, plus Claude-style
**Projects** that group conversations under shared instructions, memory, and
context. Own rail section (`/p/[propertyId]/assistant`, top-level — it is a
daily driver, not a config screen); `ASSISTANT_ROUTE` is a rail pushState
exception like Agents.

- **Data**: migration 0102 — `assistant_projects` (name/description/
  instructions/memory/emoji/tint), `assistant_project_resources`
  (`document` references — live, read through `read_document` so they never go
  stale — or inline `text` notes), `assistant_chats` (title + eve session id +
  continuation token). Everything is **personal**: RLS is `user_id = auth.uid()
  and is_member(property_id)`, so no query filters by user itself and a missed
  filter fails closed. Realtime on both chats and projects drives the sidebar.
- **Runtime**: a second VIRTUAL bot on the channel bot's machinery —
  `ASSISTANT_BOT_SLUG = "assistant"` in `apps/agent/agent/lib/agent-config.ts`.
  Its persona differs from the channel bot's in two ways that matter: it writes
  for a PAGE (headings, tables, length that follows the question) and it talks
  to exactly one person whose permissions the session already carries. Same
  catalog tool set **minus `start_background_job`** (that delivers to a Stream
  channel, which assistant sessions do not have — the executor self-gates, so
  granting it would only advertise a capability that never mounts).
- **Projects → persona**: `x-hotelclaw-project` (stamped as a `projectId`
  session attribute in `channels/eve.ts`) selects a row whose instructions,
  memory, and context are folded into the persona by `withAssistantProject`.
  The id arrives as a CLIENT header, so ownership + property + archival are all
  re-checked runtime-side; a project that is not yours degrades silently to the
  plain persona. Fail-soft — a broken project never takes the assistant down.
- **Memory + rich UI**: memory needs no slug gate (eve slots mount for every
  property-scoped session); `tools/channel-render-ui.ts` admits both virtual
  slugs. `render_ui` specs come back in the tool RESULT as
  `ai_ui_spec` and the transcript renders them inline with the same
  `AiUiAttachment` the channel uses.
- **UI** (`components/assistant/*`): `assistant-workspace.tsx` is a tab strip
  over a set of **mounted** conversation panes — switching tabs is `pushState`,
  never `router.push`, because a real navigation would tear down and re-attach
  every pane's event stream (which is the whole point of tabs); a turn running
  in a background tab keeps streaming. Which tabs are open rides in an
  `assistant_tabs` **cookie** (not localStorage) so the server can restore the
  strip on the first frame. `assistant-chat.tsx` owns one eve session;
  `project-detail.tsx` is the two-column project home (composer + conversations
  beside instructions / memory / context), split on a **container** query — the
  shell eats ~364px, so a viewport breakpoint fires far too early.
- **Gotchas, each one a bug that shipped and was caught**:
  - `/assistant` must be matched **FIRST** in `sectionFromPath` — its subtree
    (`/assistant/projects/<id>`) collides by substring with `/projects`, which
    pins Home and swapped the entire shell out from under the page.
  - The tabs cookie is written **un-encoded**. `encodeURIComponent` turns the
    separators into `%2C`, the server's `split(",")` reads one unmatchable id,
    and tabs silently vanish on any real navigation while surviving soft ones.
  - Resume is **retried** and never discards the stored session on a read
    failure. In dev the first `/eve/v1` request after a page load can 503 while
    the route compiles; treating that as "session gone" emptied the transcript
    AND made the next message fork a brand-new eve session.
  - Don't set a cancellation flag in the resume effect's cleanup — React's dev
    double-invoke fires it between passes and the pane sticks on "Loading this
    conversation…" forever.
  - Strip the `[Now: …]` framing line before rendering the user's own message
    back to them.
  - `assistant-workspace.tsx` hosts the chat's `ArtifactSidePanel` beside the
    panes (2026-10-26): an artifact card in a transcript (a task the
    assistant created, a doc it wrote) opens the split panel instead of
    navigating away. `EveConversation` also marks a Form / Questionnaire
    SETTLED when a later user message opens with its submission heading
    (`ChatUiSubmittedProvider`) — the "answers sent" state is otherwise
    client memory and a reload would bring a submitted form back live.
### Project schedules — "Scheduled" on a project (2026-08-14)

Claude's Scheduled card, wired to the app's real automation engine. A schedule
IS a workflow: `schedule.cron` trigger → one **`action.assistant.run`** step.
Same write-through contract as the Forms task-automation panel — a schedule is
visible and editable in Workflows, and one customized in the builder comes back
`config: null` and the card goes read-only.

- **The step** (`action.assistant.run`, surface `ai`): spec in
  `lib/workflows/spec.ts`, catalog entry in `catalog/ai.ts`, fields in
  `field-defs.ts`, runner in `runners/assistant.ts`. It creates an
  `assistant_chats` row (`source: 'scheduled'`, `workflow_id`) and starts an
  ASSISTANT eve session against it. That is the whole point: the output is a
  conversation you can open and REPLY to, carrying the project's persona — not
  an email. `delegate_to_openclaw` was not reusable because its session lands
  in `channel_bot_sessions`, where no human surface shows it.
- **It starts the turn and returns.** An eve turn routinely runs minutes; a
  workflow step must not block on it. Completion is announced by the assistant
  itself — when `notify` is set, the runner appends a `send_notification`
  instruction plus the conversation's deep link to the brief. Only the model
  knows when the work is actually done.
- **Pure half**: `lib/assistant/schedule-automation.ts` (cron compile/parse,
  spec build/extract/match) with tests in `lib/assistant/__tests__/`. The
  day-of-month picker caps at 28 so a monthly schedule fires every month.
- **THE bug this class of feature hides.** `TriggerFilter` is `.passthrough()`,
  so a cron placed under `trigger.filter` type-checks, validates, and renders
  correctly in the builder — and `reconcileCronSchedule` (lib/workflows/save.ts)
  reads `trigger.schedule.cron`, finds nothing, and registers no pg_cron job.
  The workflow saves and silently never fires. Validation cannot catch it; the
  smoke test asks Postgres whether a job exists.
- **`createServiceClient` now supplies a realtime transport** (`lib/supabase/
  server.ts`). supabase-js always constructs a RealtimeClient, and realtime-js
  resolves a WebSocket eagerly; inside the Vercel Workflow durable bundle there
  is no global WebSocket AND no `process`, so it threw
  "Unknown JavaScript runtime without WebSocket support". Since
  `runWorkflowSpec` builds the org scope before the first step, EVERY durable
  workflow died before doing anything — and `classifyMode` routes every
  `schedule.cron` workflow to the durable runtime. This had never surfaced
  because this codebase had never had a durable workflow.
- **Archiving a project disables its schedules** (`disableSchedulesForProject`)
  — otherwise they keep firing at a project nobody can open.
- **Verify** with `node --env-file=.env.local --no-network-family-autoselection
  scripts/assistant-schedule-smoke.mjs` — saves through `saveWorkflow` (via the
  dev-only `/api/dev/save-workflow`, since the workflows API is cookie-authed),
  asserts a pg_cron job exists, fires `workflows_emit_cron_event`, drains, then
  asserts the conversation appeared in the project with the project's memory in
  its answer, and that disabling unregisters the job. HARNESS NOTE: read the
  session stream INCREMENTALLY and stop at `session.waiting` — `res.text()`
  never resolves on a parked session, which reports an empty transcript for a
  run that answered fine.

- **Verify** with `node --env-file=.env.local --no-network-family-autoselection
  scripts/assistant-smoke.mjs` — drives the real loop (session → stream → tools
  → reply → follow-up on the continuation token → project injection → tenancy
  fences) and ends with a **channel-bot regression probe**, since the assistant
  shares that resolver and those tool gates. Two harness traps it now documents:
  `assistant_projects.user_id` is a FK, so an ownership flip to a made-up UUID
  silently fails and reports a correct runtime as leaking; and asserting the
  channel persona on the literal word "channel" fails a bot that correctly says
  "ops chat".

## AI chat surfaces on shadcn/ui AI Elements + the learning loop (built 2026-10-23; moved to shadcn/ui AI Elements 2026-10-26)

Every human-facing AI surface renders through ONE vocabulary: the
**shadcn/ui AI Elements** patterns (`ui.shadcn.com/docs/ai-elements` — the
successor of Vercel's AI Elements, which is deprecated at the end of
November 2026; "Vercel Elements" is not a product) composed from the Base
UI-native primitives in `components/ui/` (`trace`, `code-block`, `item`,
`message`, `bubble`, `message-scroller`, `hover-card`, `tooltip`), with
every SHAPE and WORDING rule in **`@hotelclaw/chat-ui/turn`** so the phone
draws the same turn. `components/ai-elements/*` is GONE (2026-10-26) — the
xyflow canvas wrappers the workflow builder used were never chat patterns
and now live in `components/workflows/builder/canvas/elements/*`; the
project skill `.claude/skills/ai-elements` documents the deprecated Vercel
CLI, so never run `ai-elements add`.

- **`@hotelclaw/chat-ui/turn`** (pure; web + mobile + runtime) — `TurnStep`
  (one row of a turn: kind thinking | reasoning | tool | skill | subagent |
  task | question | approval | waiting | step; status running | completed |
  failed | rejected | cancelled; bounded input / output / detail; times),
  `parseTurnStep` (a `channel_bot_activity` row), `transcriptTurnSteps` (an
  eve transcript item → steps; open parks excluded, settled ones become
  lines), `panelTurnSteps` (AI SDK UI-message reasoning + tool parts →
  steps), `traceSummary` ("Worked through N steps, 1 failed" + duration),
  `stepTitle` / `settledLabel` / `runningLabel` (the tense rules: the
  runtime labels a step as it STARTS, "Reading “X”…"; a settled row reads
  "Read “X”"; `toolLabel` is the done tense and `runningLabel` turns it
  present), `stepGlyph` (icon class → lucide on web, Ionicons on the phone),
  `TOOL_LABELS` / `toolLabel` / `SILENT_TOOLS` (`lib/assistant/tool-labels.ts`
  re-exports), `ParkRequest` (= the runtime's `eve_requests` entry = the
  reducer's `InputRequest`) with `parkTitle` / `parkOptions` /
  `settledParkLabel` / `parkInputLines` / `displayReplyText` (strips the
  fallback "⚠️ Approval needed" block wherever a Confirmation card renders),
  `TurnUsage` + `contextUsage` (the Context meter's arithmetic),
  `extractSources` (web_search output → links). **A new label, tense rule
  or park wording goes HERE, never in a renderer** — both apps read it.
- **`components/ai/agent-turn/*`** — the pieces every surface composes:
  `turn-trace.tsx` (`TurnTrace`, the ONE trace renderer on `Trace`: Chain
  of Thought summary → Tool rows with Code Block input/output, Reasoning
  "Thinking"/"Thought", Subagent rows, Sources, settled parks as lines;
  `live` mode for a running turn), `park-controls.tsx` (`ParkControls`:
  Confirmation = `Item` + Cancel outline / Approve filled honouring eve's
  `style`; question = Suggestion button row + free text; settled = one
  Trace line; `onChoose` / `onAnswer` decide what a tap does, so the
  channel posts the person's own message and the Assistant answers via
  `inputResponses`), `turn-usage.tsx` (`TurnUsageMeter`, Context pattern:
  Hover Card + Progress), `turn-activity.ts` (the channel's fetch-by-nonce
  store), `bot-reply.tsx` (the channel bot's turn — see the next section).
  `components/ai/markdown.tsx` is the Message pattern's markdown:
  Streamdown (cjk / math / mermaid plugins, incomplete-markdown repair) with
  fenced code routed to the Code Block primitive through `components.code`
  (Streamdown sets `data-block` on fenced code only; ```mermaid goes back to
  Streamdown's own renderer); `app/globals.css` keeps the `@source` line for
  Streamdown's classes. `components/ai/reply-actions.tsx` is the Message
  pattern's footer (`MessageFooter`: Copy swapping to a check, Good / Bad
  response as `aria-pressed` toggles, the 👎 note) used by all four surfaces.
- **`components/ai/eve-conversation.tsx`** — the ONE renderer for an eve
  session transcript (Assistant, Agents chat, pod-bot test chat, the
  read-only Fleet session viewer), built the way the Chat pattern says:
  `MessageScrollerProvider autoScroll` → `MessageScroller` → each turn a
  `MessageScrollerItem` (`scrollAnchor` on the person's turn, so a new
  question settles near the top and the reply streams under it; the view
  follows only at the live edge), the person's text a `Bubble align="end"
  variant="muted"`, the agent's turn `TurnTrace(transcriptTurnSteps(item))`
  → `Markdown` → inline `render_ui` cards → `ParkControls` for OPEN parks →
  a failure note → `ReplyActions`. Input = the reducer items from
  **`@hotelclaw/chat-ui/transcript`** (shared with mobile). The reducer keeps
  EVERY completed text block of a turn (last-wins once dropped the first
  half of a two-part answer), handles delta AND legacy cumulative streams,
  tracks `reasoning.*`, `task.*`, `input.requested/resolved` (with
  `requestId`, `kind`, `display`, `options`, the gated `action`), and treats
  `turn.waiting {on:"input"}` as the park boundary (`on:"tasks"` is not).
  `mono` (fleet) shows raw tool names as row labels; `showReasoning=false`
  drops Thought rows. Tests: `lib/fleet/__tests__/transcript.test.ts`.
  **Never memoize on `item` / `item.toolCalls` identity here** (web AND the
  phone's `EveTranscript`): the reducer settles a tool call IN PLACE
  (`call.done` / `call.output`) without replacing the arrays, so a
  `useMemo` keyed on them kept the pre-result view for the whole live turn
  — a `render_ui` chart never appeared until reload (caught 2026-10-26).
  Derive steps / specs / artifacts on every render; they are cheap.
- **`hooks/use-eve-session.ts`** — the transport both chats used to duplicate
  (and had drifted on): headers, create/resume by session id, replay-from-0
  consume with turn counting, `respond(requestId, {optionId|text})` via
  `inputResponses` (resumes the SAME turn — consume until its park, not the
  next one), 409 → fresh session, cancel, retried resume that never discards
  the stored session on a read failure.
- **`components/ai/bot-panel-conversation.tsx`** — the same composition for
  the stateless panel bots that stream AI SDK `UIMessage`s
  (`TurnTrace(panelTurnSteps(parts))`, `Markdown`, `ReplyActions`). Used by
  `task-ai-panel.tsx` and `insights-ask-panel.tsx`, which run on
  **`useChat` + `DefaultChatTransport`**. Server side, `lib/ai/run-bot.ts`
  has **`streamBot()`** (`streamText` → `toUIMessageStream` →
  `createUIMessageStreamResponse`, `sendReasoning`, provider errors masked)
  sharing `prepareBot()` with `runBot()` so the two paths can't drift on
  persona or tools; `streamTaskBot` / `streamInsightsQaBot` are the twins.
  Routes accept `UIMessage[]` OR legacy `{role, content}` turns
  (`lib/ai/ui-messages.ts` → `convertToModelMessages` with incomplete tool
  calls ignored) and authenticate cookie OR Bearer (`resolveApiCaller`) so
  mobile hits the same handlers. `refreshPinnedPrompt` still uses the
  non-streaming bot (cached answers).
- **Installing a shadcn primitive here:** `pnpm dlx shadcn@latest add …`
  fails in this repo with "Unexpected store location" (dlx runs the global
  pnpm 8 against the pnpm 10 store). Fetch the registry item directly —
  `curl https://ui.shadcn.com/r/styles/base-nova/<name>.json`, write
  `files[0].content` to `components/ui/<name>.tsx`, rewrite `from "cn"` →
  `@/lib/utils`, `@/registry/base-nova/ui/*` → `@/components/ui/*`, and
  swap the registry's `IconPlaceholder` for the lucide icon it names — then
  add the item's `dependencies` with `corepack pnpm add … --filter web`
  (`@shadcn/react` for Message Scroller). Pattern docs are plain markdown at
  `/docs/ai-elements/base/<name>.md`, primitives at
  `/docs/components/base/<name>.md`.

**The learning loop — how the AI gets better without anyone curating it:**

1. **Auto-capture** (`apps/agent/agent/lib/auto-capture.ts`, wired as
   `capture["turn.completed"]` on the PROPERTY memory slot only, so a turn
   costs one extraction). After every successful eve turn Haiku distils ≤3
   durable facts from the finished turn — property facts to property memory,
   a person's corrections/preferences to their person slot — tagged `auto`,
   importance 1. Guards: idempotent on eve's `operationId` (stamped into
   `source`, probed with `store.existsBySourceToken`), a cost gate (no model
   call for short tool-less turns), confidence ≥ 0.75, the recent memories are
   passed as "already known" so it doesn't re-learn, and it is fail-soft.
2. **Feedback** (migration 0105 `ai_feedback`): 👍/👎 + optional note on any
   reply, from every surface, via the `recordAiFeedback` server action or
   `POST /api/properties/:id/ai-feedback` (mobile, Bearer) — both call
   `lib/ai/feedback.ts:upsertAiFeedback` (update-or-insert; the unique index is
   expression-based so PostgREST `onConflict` can't name it).
3. **Nightly distil + consolidate** — `/api/memory/consolidate` (cron 03:15,
   `CRON_SECRET`) runs `lib/memory/learn.ts`: `distillFeedback` is
   DETERMINISTIC (a note becomes a per-person `preference` memory quoting what
   it was about — the person's own words are the memory; bare thumbs teach
   nothing and are just marked distilled) and `consolidateMemories` asks Haiku
   to merge overlapping `auto` memories older than 7 days once a scope holds
   ≥25 of them, writing `consolidated` facts and soft-forgetting the originals
   (`superseded_at`, never a hard delete; pinned and member-written memories
   are never touched). Tests: `lib/memory/__tests__/learn.test.ts`.
4. **The correction rule** lives in `MEMORY_DISCIPLINE` (`@hotelclaw/memory`),
   so every tier shares it: when a person corrects the bot or states a
   standing preference, remember it in the SAME turn and apply it; a recalled
   memory a person contradicts gets forgotten and re-remembered corrected.
5. The Memory browser shows the `auto` / `feedback` / `consolidated` tags
   with hover explanations, so what the AI learned on its own is visible and
   curatable (pin / forget).

**Mobile is a first-class client of all of this** — see `apps/mobile/AGENTS.md`
("Assistant + AI on mobile"): the eve channel accepts the Supabase access
token as a Bearer (`supabaseBearerAuth` in `apps/agent/agent/channels/eve.ts`,
membership-checked like the cookie path), the phone's `useEveSession` is a
port of the web hook over `expo/fetch` streaming, the task assistant reads
the same UI message stream with a 60-line SSE reader, and
`apps/mobile/components/ai/*` are the RN twins of the agent-turn pieces over
the same `@hotelclaw/chat-ui/turn` shapes (trace, parks, footer, context
meter), on the channel bot too.

**Install gotcha that bit this change (pnpm `node-linker=hoisted`):** after a
major bump, orphaned OLD copies can linger in nested `node_modules` and win
Node resolution — `apps/web/node_modules/@ai-sdk/anthropic@3` and
`node_modules/ai/node_modules/@ai-sdk/gateway@3` both survived a clean
`pnpm install` and broke `import("ai")` with "does not provide an export
named createProviderToolFactory…". If an AI SDK import fails with a missing
provider-utils export, look for a stale nested copy before touching versions.

## Channel-bot turn UI — the kitchen-sink agent turn on shadcn/ui AI Elements (built 2026-10-26)

The channel bot's reply is rendered as an agent turn on the patterns above,
and the runtime side follows eve's own reference channel
(`node_modules/eve/docs/channels/slack.mdx` "Delivery" / "Task card" /
"HITL") for what a turn shows.

- **Runtime (migration 0113)** — `channel_bot_activity` grew from a label
  feed into a structured trace: `kind` (thinking | reasoning | tool | skill
  | subagent | task | question | approval | waiting), `call_id` / `task_id`
  / `tool_name`, bounded `input` / `output` (`clipForTrace`), `detail`
  (reasoning text, "how it ended", error), `status`, `settled_at`;
  `channel_bot_sessions.turn_usage` sums eve's `step.completed` usage (+ the
  last step's input as `contextTokens`). `agent/channels/eve.ts` records one
  row PER action from `actions.requested` (preferring eve's
  `presentation[callId].label` — the tool's own `label.start` — over the
  `TOOL_ACTIVITY` map; `eve__task_wait` / `eve__task_cancel` hidden), settles
  it from `action.result` (status + output + `label.complete`), keeps
  `reasoning.completed` (agent.ts now sends Anthropic thinking `display:
  "summarized"`), `task.started` / `task.settled` (eve's task-card wording:
  "Stopped early since it was no longer needed" …), `step.started` /
  `step.completed` (usage), `turn.waiting {on:"tasks"}` ("Waiting on
  researcher…"), `turn.cancelled`, and **`input.resolved`** →
  `settleRequests`, which finds the park row by `call_id =
  request:<requestId>` (the row's own nonce names the delivered message,
  `eve-<nonce>` — the session row has already moved on to the resume turn by
  then) and `partialUpdateMessage`s the message's `eve_requests` with
  outcome + answer so every reader — web AND phone, via Stream's
  message.updated — sees the park settle in place. `deliverReply` stamps
  `eve_steps` (labels + times: the summary line without a query),
  **`eve_requests`** (structured parks: kind, prompt, options with eve's
  `style`, clipped action input) and **`eve_usage`**; park Options cards
  carry `park_request_id`; the numbered-option fallback text is gone when a
  card ships. Fixed en route: `load_skill` labels read `input.name`.
- **Web (`components/ai/agent-turn/bot-reply.tsx`)** — replaces the
  text-then-steps render for every message with `ai_generated` / `eve_turn`
  (**Stream's `isMessageAIGenerated` hook was never configured in this app
  — it is undefined for every message, so anything keyed on it never
  rendered**). Order per the Chat pattern: `TurnTrace` (summary "Worked
  through N steps · 15s" from `eve_steps`; the structured rows load on first
  open via the module store keyed by nonce, `useTurnSteps`, no per-message
  realtime) → artifact cards → text through `Markdown` (approval block
  stripped by `displayReplyText`) → `render_ui` cards (park Options cards
  are superseded by `ParkControls` when `eve_requests` exists) →
  `ParkControls` (a tap posts the option's LABEL as the person's own channel
  message via `use-quick-reply-sender.ts`; `reply_to_self` parks thread
  under the card) → `ReplyActions` (surface `channel`) with the
  `TurnUsageMeter`. `ai-thinking-indicator.tsx` renders the same `TurnTrace`
  live from the realtime rows (INSERT opens a step, UPDATE settles it).
- **Mobile** (`apps/mobile/components/ai/BotReply.tsx` +
  `attachments/CustomAttachments.tsx`) renders the same turn through
  stream-chat-expo's `WithComponents` slots — `MessageContentTopView` (the
  trace), `MessageText` (the reply through the phone's Markdown, approval
  block stripped; non-bot messages keep Stream's renderer),
  `MessageContentBottomView` (cards → `ParkControls` → `ReplyActions` +
  `ContextMeter`). See `apps/mobile/AGENTS.md`.
- **Persona** (`agent-config.ts` + the Options description in
  `packages/chat-ui/index.ts`): propose-don't-interview for open creation
  asks, every option actionable on tap, option `value` = label (never a
  sentence in the user's name), chips render BELOW the text.
- **Verify**: `bot-chat-test.mjs send … "create some tasks and projects"`
  → one reply with a plan + go-ahead chips, trace above, context meter
  below; `… "archive the document titled '…'"` → Confirmation Item; tap
  Cancel → the card settles to "Not approved: archive document" without a
  reload. Dev-loop gotchas (webhook cold compile, background `pnpm dev`) are
  in memory `channel-bot-dev-loop`.

## Fleet views — pod-bot transparency + ops (built 2026-07-19, inside the Agents section)

For properties that belong to a client (pod), the Agents section grows a
**Fleet** sidebar group (hidden otherwise; every `/agents/fleet/*` page
404s for non-pod properties). Routes live under
`/p/[propertyId]/agents/fleet` (already covered by the `AGENTS_ROUTE`
pushState exception); components in `components/fleet/*`.

- **Pod bots** (`pod-bots-list.tsx`, `bot-detail.tsx`) — gallery + two-pane
  workspace: owner-editable config (tool allow-list from
  `lib/fleet/tool-catalog.ts` — a MANUAL mirror of
  `apps/agent/agent/tools/pod-tools.ts`, keep both in sync; model tier;
  persona) with a provenance block (persona source, memory), beside a live
  test chat driving the REAL pod bot.
  `AgentChat` was parameterized for this: `target: {agentId}|{botSlug}`
  emits `x-hotelclaw-agent` or `x-hotelclaw-bot`; bot targets skip
  `recordAgentSession` (FKs `agents`). Paused pod ⇒ banner + disabled chat
  (a paused client silently resolves to the base persona otherwise).
- **Sessions** (`sessions-view.tsx`, `session-transcript.tsx`) — all
  `bot_chat_sessions` rows (chat + `workflow:*` runs); `?session=<eve id>`
  opens a read-only Sheet transcript fed by the tenancy proxy
  `/api/properties/[propertyId]/fleet/sessions/[eveSessionId]/stream`
  (membership + row-match = the gate; NEVER let the client hit `/eve/v1`
  with arbitrary ids). Rendering shares `lib/fleet/transcript.ts` (the
  pure NDJSON reducer agent-chat also uses).
- **Approvals** (`approvals-view.tsx`) — migration 0077 added
  `status`/`pending_approval` to `bot_chat_sessions` (+ realtime
  publication); `lib/stream/pod-bot-reply.ts` stamps the park on
  `input.requested` and clears it on any completed turn. Approve/Deny call
  `decideApproval` → `runPodDecisionTurn` (same mechanism as chatting
  "approve": bare decision + continuation token, with tail-recovery via
  `lib/fleet/eve-session.ts:readSessionTail` when the stored token is
  stale; outcome posts to the Stream channel; workflow sessions skip the
  channel post). `trigger_workflow` (actions-MCP) tail-consumes in
  `after()` so workflow parks reach the inbox too. Amber badges: Approvals
  sidebar item + the Agents row in the sidebar's More fold.
- **API access** (`access-view.tsx`, `actions-api-dialog.tsx`, route
  `/agents/fleet/access`) — the Actions API key manager
  (`api_tokens.allowed_tools` multi-select over
  `lib/mcp/actions-tools.ts:ACTIONS_MCP_TOOLS` — the route's `requireTool`
  is typed against it so registrations can't drift; reveal-once, revoke).
- **Writes**: fleet tables have NO member write policies — server actions
  (`components/fleet/actions.ts`) use the org-chart pattern (role gate via
  RLS client, write via service client, row-tenancy re-checked).
- **Verify** with `scripts/fleet-approvals-test.mjs` (park → payload →
  UI-path decision via `/api/dev/fleet-decide` → clear + channel outcome)
  plus `scripts/pod-bot-chat-test.mjs` and `scripts/actions-mcp-test.mjs`.

## Tier 2 — eve (OpenClaw retired, 2026-07-19)

Eve owns the whole durable-agent slot: long-running, multi-step, approval-gated work runs as durable eve sessions (the same runtime behind the fleet pod bots, the Agents section, and the channel bot). `delegate_task` (`lib/ai/tools/delegate.ts` → `lib/ai/eve-delegate.ts`) hands a self-contained brief to a fresh eve session with the service bearer; the session is recorded in `channel_bot_sessions` (`delegate:<sessionId>`, 0078) so subagents can recover tenant scope and the work is discoverable. The workflow action keeps its historical id `action.external.delegate_to_openclaw` (saved workflows) but its runner (`lib/workflows/runners/system.ts`) delegates to eve. Recurring delegation is NOT wired (eve schedules are authored files) — bots point users at Workflows instead.

**FULL CONTROL SURFACE — PHASE 2 (2026-07-23, latest):** the channel bot now covers every major app surface (36 grants; `AgentConfigZod` tools cap raised to 64). New catalog tools (`apps/agent/agent/tools/catalog.ts`, entries in `packages/agent-config`): **meetings** `schedule_meeting`/`update_meeting`/`cancel_meeting` (direct inserts minting `stream_call_id: meeting-<uuid>`; `started_at` mirrors `scheduled_start`); **bookings** (removed 2026-10-29) `create_booking`/`update_booking_status` → service-bearer `/api/internal/bookings` (POST runs `createBookingChecked` with `bypassRules` like staff — NEVER a raw insert — returning alternatives on a full slot; PATCH enforces the STATUS_TRANSITIONS state machine — a mirror of components/bookings/actions.ts, keep in sync — and emits `booking.cancelled`); **spreadsheets** `read_sheet`/`update_sheet_cells` → `/api/internal/sheets` + `lib/spreadsheet/write-cells.ts` (Liveblocks `mutateStorage` on the workbook LiveObject, A1→`colId@rowId` via the sheet's id arrays, snapshot repersisted after; `LiveObject` is importable from `@liveblocks/node`); **forms** `create_form` (server-assigned field ids `fN_<rand>`, option ids likewise)/`set_form_status`/`share_form_to_channel` (posts the same `{type:"form"}` attachment as the app's Share button); **tasks** `delete_task` (approval-gated), `escalate_task` (ladder: assignee's `memberships.manager_id` → team `lead_user_id` → owners/managers; `task_escalated` notification — the renderer case existed, deduped a pre-existing duplicate switch case), `create_project`, and `update_task` grew labels_add/labels_remove/project_name; **comms** `send_notification` (new `ai_message` type + renderer case; notifications.type has NO db CHECK), `post_to_channel` (tenancy guard: id must start `prop-<pid.slice(0,8)>`); **workflows** `list_workflows`/`trigger_workflow` (manual.run emission identical to the app's run route; only enabled + `trigger.event_type==='manual.run'` specs); **docs** `restore_document_revision` (lists/reads the 0094 stash via `?revisions=1`/`?revisionId=` on the internal read route, restores via the write route — the restore itself stashes first, so it's undoable). **Turn messages now carry a `[Now: <ISO> (UTC)]` line** (`channel-bot-eve.ts`) — without it the model resolved "tomorrow" into its training-data year (a probe scheduled a meeting in 2025). All probed live end-to-end 2026-07-23: meeting/sheet/form/booking/cancel/notify/label/escalate rows + workflow events verified in DB.

**THINKING INDICATOR IS DB-DRIVEN (2026-07-23):** the bot's "thinking" state is `components/chat/ai-thinking-indicator.tsx` — a row PORTALED into `.str-chat__message-list-scroll` (so it scrolls with the conversation like a real message) that watches `channel_bot_sessions.turn_state` over Supabase Realtime (0078 publication + member SELECT RLS) and therefore spans the WHOLE eve turn; after 25s the copy softens to "Still working on it". Stream `typing.start/stop` is GONE from the bot path (web + runtime) — Stream expires typing client-side after seconds while turns run minutes, and its indicator layout misaligned with the Slack message grid. The row reuses Stream's own avatar classes (`str-chat__avatar--one-letter` etc.) so the avatar matches real bot messages exactly; root `_root` rows only (thread turns + `job:` rows excluded). The artifact side panel is drag-resizable (pointer-captured left-edge handle, 380px–85vw; expand button snaps between ~46vw/~72vw presets).

**READ-BEFORE-EDIT + PANEL FIX (2026-07-23):** `read_document` catalog tool → `/api/internal/documents/read` → `readDocumentBodyHtml` (body_json → `generateHTML` with the writer's extension set) gives the bot FULL faithful-HTML doc bodies — required for surgical edits ("add X to the contacts list"): read → edit the HTML → `update_document(mode: replace)` with everything unchanged preserved (verified live; revision stash still guards the replace). Instructions mandate read-before-edit and forbid "can't read the doc" replies. **RENAME (2026-07-25):** the bot can set a document's RECORD title (separate from the body's `<h1>` — the record title is what shows in lists, artifact cards, and search) via `rename_document(document_id, new_title)` or `update_document`'s optional `new_title` (rename + rewrite in one call). Both go through the internal write route, which grew a title-update branch on the UPDATE path (title-only renames skip `writeDocumentBody`; the gbrain-era re-mirror hook is gone — Postgres FTS is the only index). This closed the gap where the bot wrote titled SOP content into 'Untitled' docs but told the user to rename them in the UI — the persona now forbids that deferral. The artifact side panel is a TRUE LAYOUT SPLIT (2026-07-23): a plain `<aside>` flex sibling of Stream's `<Window>` inside `.str-chat__container` (the same mechanism as the thread panel), so the chat column genuinely compresses — no overlay, no fixed positioning, header = "title · Document|Spreadsheet" + expand toggle + open-full-page + close. It mounts `DocumentEditor` for docs and `SheetEditor` for sheets (artifact `kind` widened to `"document"|"sheet"` in `@hotelclaw/chat-ui`; `update_sheet_cells` posts a sheet artifact card that flips to done/edited). **TASK ARTIFACTS (2026-08-26):** `kind` widened again to include `"task"` — `create_task` posts an artifact card per created task (single post, already `status:"done"` + `action:"created"` with `task_id` + href: a task insert is instant, so there's no writing→done flip and `artifact-auto-open.tsx` deliberately skips task cards — nothing live to watch, and a 9-task turn would pop the panel on task 1). The card opens `TaskRoom` in the side panel via `TaskPanelBody` (artifact-side-panel.tsx), which refetches the `["tasks", propertyId]` list once when the id is missing — that cache has NO realtime invalidation, so a seconds-old bot task isn't in the viewer's stale copy and TaskRoom would wrongly say "no longer available". Eve-build gotcha that bit here: the transform's closure capture is token-naive INCLUDING COMMENTS — a comment saying "document tools" captured the whole `tools` record into `__closureVars` until reworded. Never use the Sheet primitive for this — it hardcodes a blurring overlay and a `data-[side=right]:sm:max-w-sm` (384px) width that custom classes can't override across variant stacks (first cut shipped dimmed + too thin because of this).

**ARTIFACTS + LIVE SPLIT-SCREEN (2026-07-23):** document writes are now COLLABORATIVE-GRADE and WATCHABLE. (1) `lib/documents/write-body.ts` writes via ProseMirror TRANSACTIONS (`api.update`), not whole-body `setContent`: append inserts at the live end (concurrent human edits merge via Yjs — no clobber), replace clears once then streams blocks in grouped transactions with pacing — anyone viewing the doc watches it being written. (2) The write tools post an **`app_artifact` Stream attachment** (payload + guard in `@hotelclaw/chat-ui:isAppArtifactAttachment`) the moment the write STARTS (status "writing", deterministic id `eve-artifact-<callId>` so replays dedupe) and flip it to "done" via `partialUpdateMessage` — **`sendMessage` with an existing id DEDUPES, it does NOT update**. (3) `ArtifactCard` (`components/chat/artifact-card.tsx`, wired in `slack-attachment.tsx`) → "Watch live" opens `ArtifactSidePanel` (`artifact-side-panel.tsx`, provider in layout.tsx next to InfoPanelProvider): a wide right Sheet mounting the REAL `DocumentEditor` (self-contained RoomProvider; Liveblocks auth comes from the /p layout) — bot edits stream in live, and the viewer can co-edit. HARNESS GOTCHA: artifact cards are bot messages with EMPTY text — `waitForBotReply` must require non-empty text in its find predicate or it latches onto the card forever.

**CHAT AS CONTROL SURFACE — WRITE TOOLS, PHASE 1 (2026-07-23):** the channel bot can now DO things: `update_task` (status/priority/due/assignee-by-name/title/description — tasks DB triggers fire workflow automations automatically per 0026/0040; the executor mirrors the app's assignment notification), `create_document` + `update_document` (REAL content: sanitized HTML → ProseMirror JSON → Liveblocks `withProsemirrorDocument.setContent` with a custom `getSchema` schema — the library default rejects tables — → Postgres snapshot; via the service-bearer endpoint `/api/internal/documents/write` + `lib/documents/write-body.ts`, the seed-demo recipe extracted; `/api/*` bypasses proxy middleware so the route self-authenticates), and `archive_document` (eve `approval: always()` — parks to the fleet Approvals inbox). Verified live: "write the freezer SOP" → 2.7KB doc written + deep link in 30s. **Write-path doctrine (from the 2026-07-23 inventory):** tasks/entities have DB triggers → direct service writes fire automations; docs/bookings/forms/meetings do NOT — doc content must use write-body, bookings must use `createBookingChecked` + `emitWorkflowEvent`, form submits must validate + emit `form.submitted`; notifications = plain insert. Phase 2 (planned): meetings/bookings/forms/notify tools + artifact cards in chat (AI-Elements-style attachment opening a split-screen live doc panel — Liveblocks makes bot edits render live for free).

**AUTOMATED TESTS for the AI stack (2026-07-23):** three layers. **(1) Unit/contract** — `pnpm test` (vitest): `lib/memory/__tests__/memory-package.test.ts` (scope wall against a fake query builder, recall formatting, query extraction, tool contracts, `chunkStreamText`, MEMORY_DISCIPLINE invariants) and `lib/agents/__tests__/agent-runtime-sync.test.ts` — DRIFT GUARDS that read apps/agent source text: every catalog id has an executor gate and vice-versa, channel-bot grants valid, RPCs exist in migrations, the eve transform tripwires (no `const url`/`const cred` in dynamic-tool modules, no captured helper fns), the ChannelEvents keys are all supported hooks, role gates check senderId, fleet mirror in sync. Each guard has a documented incident behind it. **(2) DB integration** — `lib/stream/__tests__/channel-bot-queue.test.ts` (claim atomicity, queue, stale recovery, job-row isolation) against the real dev Supabase; self-skips without env — run with `node --env-file=.env.local node_modules/.bin/vitest run` (vitest aliases `server-only` to a stub). **(3) Live end-to-end** — `bot-chat-test.mjs` gained `parallel` (queue-drain, non-member role-gate refusal, full background-job lifecycle incl. the Stream-side result message). Run `suite`, `stress`, AND `parallel` before claiming channel-bot changes work.

**CONCURRENCY: LOSSLESS QUEUE + BACKGROUND JOBS (2026-07-23, migration 0093):** per the eve docs' prescribed pattern ("keep your own per-session queue in the channel or app layer, then deliver the next message after the session parks again" — execution-model-and-durability.md): the webhook CLAIMS the (channel,thread) turn slot atomically in Postgres (`turn_state`/`turn_started_at`; 10-min stale-claim recovery; the Redis TTL lock is gone) — a message that can't claim is ENQUEUED in `channel_bot_queue`, never dropped, and the runtime's `session.waiting` handler drains the queue into the next turn immediately using the fresh continuation token (self-POST via `drainQueueOrIdle`; the next web turn is the fallback drainer). For heavy work, the channel bot has **`start_background_job`** (catalog tool): spawns a DETACHED eve session per job ("Separate sessions still run independently"), acks instantly, keeps the channel free — N users get N parallel jobs; the job's result is delivered by the same events machinery (kind='job' row, headline-prefixed, top-level). GOTCHA: **Stream silently discards messages over ~5KB** (the send "succeeds", the message never exists) — `deliverReply` chunks long results (4.2KB chunks, continuations as thread replies, deterministic ids `eve-<nonce>-N`). Verified: mid-turn message queued+drained+answered; 19KB job report delivered chunked; suite 9/9, stress 3/3.

**CHANNEL-BOT DELIVERY IS EVENT-DRIVEN (2026-07-23):** the webhook no longer holds a function open reading the session stream — it classifies, queues the eve turn (create/resume + `channel_bot_sessions` upsert stamping `turn_nonce`/`channel_type`, migration 0092), and returns in milliseconds. The eve channel's `events` handlers (`apps/agent/agent/channels/eve.ts` + `agent/lib/channel-delivery.ts`) accumulate the turn durably ON THE ROW (`reply_candidate` from message.completed — last wins; `ui_spec` from a render_ui action.result; `pending_approval` from input.requested) and on `session.waiting` post the reply + ai_ui to Stream (deterministic message id `eve-<nonce>`; `delivered_nonce` guard = replay idempotency), store the fresh continuation token, and release the generation lock (Upstash REST; web acquires it, TTL 180s is the crash fallback). `session.failed` posts the ⚠️ (fail-loud preserved). Scope guard: only sessions with `botSlug: hotelclaw` + `channelId` and no agentId — agent chats, pod bots, delegates keep their existing paths, and fleet decision turns (no nonce re-stamp) never double-post. GOTCHAS: eve's `ChannelEvents` has NO `message.received` hook (the nonce is stamped web-side for this reason), and the harness's reply windows are sized to the turn (90s floor), not a function budget. `consumeTurnStream` remains for pod bots + fleet decision turns only. Turn length is now unbounded — an eve turn can run minutes and the reply still lands.

**CHANNEL BOT IS ON EVE + MEMORY (2026-07-19; memory replaced the brain 2026-10-23):** the webhook + classifiers (`ai-auto-classifier`, engagement) are unchanged, but default-bot GENERATION runs as one durable eve session per (channel, thread) — `lib/stream/channel-bot-eve.ts` → the virtual `hotelclaw` agent (`apps/agent/agent/lib/agent-config.ts:CHANNEL_BOT_SLUG`: synthetic config → catalog property tools + Sonnet) + the memory slots (`apps/agent/agent/memory/*`). Context packing sends only unseen messages; engaged-mode memory IS the session (Redis turn-cache unused on this path); NO coalesce loop (eve sessions are not a message queue — mid-turn messages arrive as unseen context next trigger); the acting principal is the sender when they're a member, else the property's earliest owner/manager (test users aren't members). Eve is the ONLY engine for staff channel chat (2026-07-20: the `EVE_DEV` gate and the not-configured legacy state are both GONE — eve mounts unconditionally in dev and deploys as the Vercel Build Output service in prod). Any eve failure FAILS LOUDLY — visible ⚠️ error message posted to the channel, never a silent fallback. Custom-chatbot **channel deployments ride the same eve session** as the default bot: `channel-bot-eve.ts` sends `x-hotelclaw-channel`, the runtime resolves `chatbot_channel_deployments` in `resolveSessionAgent` (persona + tier swap) and mounts the deployment's knowledge search + `custom_<slug>` tools via `apps/agent/agent/tools/channel-deployment.ts` (executor + crypto ported to `agent/lib/custom-actions.ts` / `action-crypto.ts` — keep in sync with the web guest-side originals), so deployed bots get durable memory, gbrain, and render_ui; changing a channel's deployment resets its `channel_bot_sessions` row so the new persona takes effect immediately. The legacy stateless `runBot()` channel path is deleted; `runBot()` remains for panel bots and guest surfaces only. `render_ui` rich cards work on this path too: the chat-UI catalog lives in the workspace package `@hotelclaw/chat-ui` (zod schemas + spec validation + deep-link resolution; `lib/ai/chat-ui/catalog.ts` is now a re-export shim), the eve tool is `apps/agent/agent/tools/channel-render-ui.ts` (same validation + link discipline, but no sink — the validated spec comes back in the tool RESULT as `ai_ui_spec`), and `consumeTurnStream` (`lib/stream/pod-bot-reply.ts`) collects it from the session stream for `ai-reply.ts` to revalidate and post as the `ai_ui` attachment. Turn attribution gotcha: the session stream replays from index 0 and turn text is boilerplate-identical across turns, so `channel-bot-eve.ts` prefixes each turn message with a `[turn <uuid>]` nonce and uses THAT as the consume needle — a text-prefix needle silently captures an earlier turn's reply (and drops the spec).

## eve 0.83 runtime contract (upgraded from 0.27 on 2026-10-23)

`apps/agent` runs **eve 0.83.0** (was 0.27.13 — 56 minor releases; the
research + decisions are in `docs/ai-layer-eve-0.83.md`). What changed in
the contract this repo codes against:

- **Sessions are addressed by durable id only.** `POST /eve/v1/session/:id`
  with `{message}` OR `{inputResponses}` (exactly one). Continuation tokens are
  GONE (0.31): the `*continuation_token` columns stay in the schema but nothing
  reads them. A follow-up that answers `409 session_not_active|stranded`
  (expired, reset, or built by an older runtime) starts a fresh session —
  every web caller does this (`channel-bot-eve.ts`, `pod-bot-reply.ts`,
  `agent-chat.tsx`, `assistant-chat.tsx`).
- **A question or approval HOLDS THE TURN OPEN (0.70).** The stream emits
  `input.requested` then `turn.waiting {on:"input"}` and the same turn
  resumes when a person answers; `session.waiting` fires only when the turn
  truly ends. The channel's delivery therefore has TWO park points
  (`agent/channels/eve.ts`: `turn.waiting` on input + `session.waiting`), the
  transcript reducer unblocks the composer on either, and `consumeTurnStream`
  / `readSessionTail` treat `turn.waiting` on input as the settle point.
  `turn.waiting {on:"tasks"}` (subagents still working) is NOT a settle point.
- **Answers go through `inputResponses`.** The web glue addresses a parked
  question/approval by `requestId` (a freeform reply rides as `text`); a plain
  message would STEER the held turn and withdraw the question. Approval
  options are `approve` / `cancel` (`deny` is pre-0.32; the pod card and
  decision path map it).
- **Opt-in tools are authored.** `ask_question`, `no_reply`, `sleep` live in
  `agent/tools/` (0.65 made `ask_question` opt-in — without the file the
  persona's "pause and ask" rule silently stops working). `glob`/`grep` slots
  are deleted (opt-in now; a `disableTool()` on an opt-in slot can fail the
  build). `bash`/`read_file`/`write_file` stay disabled; `web_fetch`/`web_search`
  (Anthropic native search on the direct provider) are eve defaults and ON.
- **Model = dynamic selection object.** `agent.ts` returns
  `{ model, reasoning, modelOptions }` per step (no compiled fallback since
  0.33): advanced tier Sonnet 5.5 (was Opus 5 until 2026-10-27) at `reasoning: "medium"`, 1-hour Anthropic
  prompt-cache TTL on both tiers. Limits are `limits.sessionUsage` (0.82);
  `experimental.workflow.retention: "default"` keeps finished sessions'
  transcripts readable (private sessions default to retention 0).
- **Subagent calls are tasks (0.69).** Every `agent`/declared-subagent call
  returns a receipt and the turn holds via `turn.waiting {on:"tasks"}` until
  the result lands; `eve__task_wait`/`eve__task_cancel` appear automatically.
  Skills load via `eve__skill` (0.76) — the `load-skill` action still reports.
- **Typecheck the runtime**: `pnpm --filter agent typecheck` (tsconfig added
  2026-10-23; `types: ["eve/workflow-modules"]`). `eve build` from
  `apps/agent` compiles the agent (0 diagnostics expected) without needing
  Vercel/Docker; `eve info` lists tools/schedules.

## Substrate — property memory (eve memory slots over Postgres; gbrain retired 2026-10-23)

Memory is an **eve first-class slot** (`defineMemory` + a custom
`defineMemoryProvider`, docs/memory/custom-provider) over the app's own
Postgres — **no second server, no OAuth clients, no provisioning, no document
mirror**. The gbrain Railway serve, `property_brains` provisioning, the doc
mirror cron, `packages/brain`, and `infra/` are gone; the `brain_*` columns
remain in the schema unused.

- **ONE implementation, two runtimes:** `packages/memory` (`@hotelclaw/memory`)
  owns the store (`createMemoryStore(db)` over any supabase-shaped client:
  search → `search_agent_memories` FTS RPC → word fallback; pinned; recent;
  remember (dedupes identical content); forget = soft-retire via
  `superseded_at`; `listProperty` for the browser), the tool contracts
  (`memoryToolDescriptions/Schemas`: remember / forget / search), recall
  formatting (`formatRecall`), the turn-query extractor
  (`recallQueryFromInput` strips the channel bot's `[turn…]`/`[Now…]`/
  `[Activation…]` framing), scopes (`propertyScope`, `userScope`,
  `guestScope` — guest subject ids are sha256 hashes of phone/email), and the
  `MEMORY_DISCIPLINE` standing rules. `chunkStreamText` moved to
  `@hotelclaw/chat-ui`.
- **Data** (migration 0104): `agent_memories` (property_id, `subject_kind`
  property|user|guest, `subject_id`, `kind` fact|preference|event|outcome|
  playbook, content ≤2000, source, tags, importance, `pinned`, created_via
  agent|app|member|import, `superseded_at`, generated `tsv`, reserved
  `embedding vector(1536)`), member SELECT via `is_member`, writes service-only;
  `search_agent_memories(...)` is security-definer and granted to service_role
  only. `agent_memory_documents` is reserved (unused).
- **Runtime** (`apps/agent/agent/memory/property.ts`, `person.ts` →
  `lib/memory-provider.ts`): scope = `[propertyId]` / `[propertyId, person]`
  from VERIFIED auth attributes (`senderId` when the channel bot acts as a
  fallback principal); `null` scope ⇒ no slot (subagent children, bare
  sessions). eve recalls at `turn.started` — pinned core facts + up to 8
  relevance hits as ONE user-role message with a stable id
  (`<slot>:recall`, superseded each turn, never stacked) — re-recalls pinned
  facts after compaction, and mounts `property__remember / __forget /
  __search` + `person__…` (tool executors close over plain strings only —
  eve build-transform rule). Pod bots get the same slots; `brain_query/
  brain_write/playbook` are gone and the pod persona is `bots.persona_fallback`.
- **Web:** `lib/memory/store.ts` (`memoryStore()`, `rememberForProperty` for
  deterministic writers, `memoryContextLines` prefetch), `lib/memory/tools.ts`
  (`buildMemoryTools` → `property__search/remember/forget` for every
  `runBot()` surface; single-turn bots get no automatic recall, so the prompt
  tells them to search), `lib/memory/guest-profile.ts` (guest side-channel:
  prefetch into the guest prompt, deterministic `captureGuestDetails`; guests
  NEVER get memory tools). Deterministic writers: meeting summaries (`event`),
  accepted triage routings (`outcome`), the workflow step
  `action.gbrain.capture` (id kept for saved workflows → `rememberForProperty`),
  the pod outcomes hook. Automation suggestions and triage prefetch memory
  context instead of calling a brain.
- **UI:** Agents → **Memory** (`/p/<pid>/agents/memory`,
  `components/memory/memory-browser.tsx` + `actions.ts`, API
  `GET /api/properties/[propertyId]/memory`): counts per subject kind, search,
  grouped listing, owner/manager curation (add a fact, pin = recalled every
  turn, forget). The agent editor's resolved-config panel shows memory as
  always-on; the fleet page `/agents/fleet/access` keeps the Actions API keys.
- **Verify** (`pnpm test`): `lib/memory/__tests__/memory-package.test.ts`
  (scope wall against a fake builder, recall formatting, query extraction,
  tool contracts) + `agent-runtime-sync.test.ts` guards (memory slots scope
  from auth attributes, provider executors capture strings only,
  `turn.waiting` registered, opt-in tools authored). Live:
  `bot-capability-test.mjs --only action/memory-remember` asserts the row in
  `agent_memories`. The classifier capability map no longer lists memory —
  recall is automatic, so auto mode doesn't need to "volunteer" it.
- **Knowledge discipline + retrieval ladder:** every bot tier gets
  `MEMORY_DISCIPLINE` (three source kinds — Documents = authored truth,
  memory = recalled + searchable institutional memory, app tools = live
  records; check every surface before asserting absence; cite
  `[memory #id]` / doc titles). The procedure is the eve skill
  `apps/agent/agent/skills/knowledge-lookup.md` (step 0: read the recalled
  block). `search_tasks`, `list_documents`, `list_meetings`,
  `search_chat_messages`, forms/handover/insight readers are unchanged.
- **What we deliberately did NOT adopt (see the report):** Vercel Drives as
  the knowledge store (sandbox-mount only — a Next.js route cannot read or
  write a Drive; single read-write mount; Postgres is already canonical and
  no sandbox is ever opened by these agents today, so Drives would add cost
  for a worse search), Vercel Daemons (no persistent storage, no previews,
  cannot attach to a project rooted at `apps/web`), computer-use/browser
  extensions (need a prepared apt image; no ops use case yet), and
  `fileMemory()` on Blob (per-scope 4 KB document — too small for a property's
  institutional memory; our Postgres provider is the documented alternative).

## The boundary in one sentence

> If the response can be generated in a single turn and lives within one surface, it's Tier 1 (a stateless bot). If it needs to live longer than a request, pause for a human, or remember across sessions, it runs on eve — and anything durable the property LEARNS belongs in the brain.
