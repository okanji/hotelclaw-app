# The AI layer on eve 0.83 — research, decisions, and what shipped (2026-10-23)

This replaces the plan in `~/Downloads/hotelclaw-always-on-agents-plan.md`,
which was written for a different project (a WhatsApp-only eve agent with no
Next.js app, no Supabase, no Stream). Every claim below was checked against
eve 0.83.0's bundled docs (`node_modules/eve/docs`, which match the installed
version), its CHANGELOG, and Vercel's current docs/KB pages. Where the old
plan was right it is adopted; where it did not apply to this codebase it says
so and why.

## 1. What was actually true before this change

- `apps/agent` ran **eve 0.27.13**. npm's latest was **0.83.0** (published
  2026-10-23). eve ships a minor every 1–2 days and labels almost none of them
  breaking, but between 0.27 and 0.83 the HTTP contract, the park semantics,
  the tool defaults, the model API and the limits API all changed.
- Institutional memory lived in **gbrain**: a separate server on Railway, one
  OAuth client per property provisioned over HTTP, an AES-encrypted secret per
  property in `property_brains`, a nightly cron mirroring every document into
  the brain, a Railway maintenance box for sync/doctor/dream, and ~2,500 lines
  of web + runtime glue plus a local patch to the gbrain CLI. The brain's job
  was to remember what the property learns and to make documents searchable;
  documents were already searchable in Postgres.
- The checkout had no `.env.local`, no Vercel link and no Docker, so nothing
  here was verified live. Verification was: `tsc` on both apps, vitest, and
  `eve build` / `eve info` (0 diagnostics).

## 2. Research findings that drove the design

**eve (0.83.0)**

| Area | Fact | Source |
|---|---|---|
| Sessions | `POST /eve/v1/session/:id` with exactly one of `message` or `inputResponses`; continuation tokens removed in 0.31; `409 session_not_active \| session_stranded` for dead sessions; sessions built before 0.45 report inactive after upgrade | channels/eve, sessions-runs-and-streaming, CHANGELOG 0.31/0.57 |
| Parks | since 0.70 a question/approval holds the turn: `input.requested` → `turn.waiting {on:"input"}`; `session.waiting` only when the turn ends; `on:"tasks"` while subagents work | execution-model, tools/tasks, CHANGELOG 0.70 |
| Memory | first-class slots: `defineMemory({provider, scope})`; `defineMemoryProvider({recall, capture, tools})`; recall enters as attributed user-role messages with stable ids; a provider "can be a Postgres table"; scope locked per turn from auth; `fileMemory()` on Blob is a 4 KB/65 KB per-scope doc | memory/overview, memory/custom-provider, memory/file, patterns/multi-tenant-memory |
| Tools | `ask_question`, `no_reply`, `sleep`, `glob`, `grep` are opt-in; `bash`/`read_file`/`write_file`/`web_fetch`/`web_search`/`agent` are defaults; `deferred: true` + `eve__search` for big catalogs; `endsTurn`; `label` | concepts/built-in-tools, tools/overview |
| Model | `defineDynamic` returns a concrete selection `{model, reasoning, modelOptions}`; no fallback (0.33); provider objects only from `step.started`; `promptCache: {anthropic:{ttl:"1h"}}` | agent-config |
| Limits | `limits.sessionUsage(({total, window}) => boolean)` (0.82); `sessionTimeoutMs` is idle; private sessions default to run-data retention 0 (finished transcripts unreadable) unless `experimental.workflow.retention: "default"` | agent-config |
| Durability | one Workflow run per session; checkpoint per step; parked turns hold no compute; compaction moves the session to a fresh run; `withEve` coexists with `withWorkflow` (0.47.7) | execution-model, CHANGELOG |
| Schedules | `defineSchedule` → Vercel Cron; markdown schedules can't take input (approval fails them); `no_reply` for "nothing to report"; dynamic schedules are experimental + org-flagged | schedules, experimental/dynamic-schedules |
| Sandbox | `DefaultSandbox` picks Vercel Sandbox on Vercel; Drives mount via `@vercel/sandbox` `Drive.getOrCreate` + `mounts`; one read-write mount per Drive; `drive.snapshot()` for readers | sandbox/vercel, sandbox/default |

**Vercel platform (Oct 2026)**

- **Drives** (GA 2026-10-15): persistent storage mounted INTO a sandbox. "You currently need to mount a drive into a sandbox to read and write files" — a Next.js route cannot read or write a Drive; one read-write mount at a time; snapshots for concurrent readers; forks never merge back. Pricing $0.05/GB-month + per-GB reads/writes.
- **Daemons** (public beta): pull-based container workers, production only, **no persistent storage**, and "projects with a root directory subfolder (e.g. `apps/web`) can't add daemons yet" — this monorepo cannot use them today.
- **fx**: Vercel Labs' Zig-kernel coding-agent harness (`libfx`), a sibling of eve on the same Workflow/World substrate. Not an eve concept and not needed here; eve is already durable.
- **"Brain, hands, files"** (Rauch) and the Stanford always-on lecture (Robinson): wake/sleep durable workflows, a router that decides whether to interrupt, thin client, steering + coalescing, auto-review of commands, prompt-cache hygiene, compaction timing, layered memory (core facts every turn → dated logs → scratchpad → files). eve already implements the substrate parts; the product parts (router, memory layering) are ours.
- **Computer use / browser**: `eve/computer-use` needs an apt image prepared in `prepare`; `@agent-browser/eve` runs Chromium in the sandbox. No ops use case yet.

## 3. Decisions

1. **Upgrade eve to 0.83.0 (exact pin).** Everything else depends on it. The
   upgrade breaks every stored continuation token; every web caller now
   addresses sessions by id and starts fresh on 409.
2. **Retire gbrain; memory becomes an eve memory slot over the app's Postgres.**
   The brain's one real job maps exactly onto eve's provider contract, and
   recall becomes automatic (eve injects relevant memory before the model
   runs) instead of a tool the model has to think to call. Documents do not
   need a mirror. This deletes the Railway service, provisioning, crypto,
   OAuth clients, the mirror cron, `packages/brain`, `infra/`, and the brain
   UI; it adds `packages/memory`, migration 0104, two memory slots, and a
   Memory browser.
3. **Do not adopt Drives for knowledge.** A Drive is a sandbox mount with a
   single writer and no SDK read path from routes; this app's knowledge is
   relational, searched with FTS, read by Next.js routes, and written
   concurrently by many sessions. These agents open no sandbox today (file
   tools are disabled), so Drives would add a running sandbox per session
   for a worse search. Revisit when an agent genuinely works on files
   (bulk CSV analysis, report archives) — the pattern is the Drives starter's
   snapshot-mount + short-lived read-write writer.
4. **Do not adopt Daemons, computer use, browser, or `fileMemory()` on Blob**
   (reasons above). Do not add an LLM heartbeat schedule: the deterministic
   insight/alert sweeps already play the "router" role at zero model cost;
   project schedules already cover per-user scheduled briefs.
5. **Adopt the lecture's hygiene where eve exposes it:** 1-hour Anthropic
   prompt-cache TTL, session-scoped dynamic instructions, stable-id recall
   messages (superseded, never stacked), pinned "core facts" recalled every
   turn, `no_reply` for silent turns, `sleep` for durable waits,
   `ask_question` restored as an authored tool, retention kept so transcripts
   stay readable.

## 4. What shipped

Runtime (`apps/agent`)
- eve 0.83.0, ai 7.0.150, @ai-sdk/anthropic 4.x; microsandbox removed;
  `tsconfig.json` + `pnpm --filter agent typecheck`.
- `agent/agent.ts`: dynamic selection objects (Opus 5 medium reasoning +
  1h cache; Haiku defaults), `limits.sessionUsage`, retention default.
- `agent/channels/eve.ts`: typed handlers, `turn.waiting` park delivery,
  `turn.failed` reason surfaced, `session.waiting` delivery + queue drain by
  session id; request `kind` stored on parks.
- `agent/tools/ask_question.ts`, `no_reply.ts`, `sleep.ts`; `glob`/`grep`
  slots removed; brain tools removed from the catalog and pod tools.
- `agent/memory/property.ts`, `person.ts` + `lib/memory-provider.ts`
  (recall / compaction recall / remember / forget / search); outcomes hook
  writes memory; instructions carry `MEMORY_DISCIPLINE` + a Memory section;
  `skills/knowledge-lookup.md` rewritten around recall-first.
- Evals ported to the 0.59+ API (`turn.message`).

Shared
- `packages/memory` (`@hotelclaw/memory`): store, tool contracts, recall
  formatting, query extraction, scopes, discipline text. `chunkStreamText`
  moved to `@hotelclaw/chat-ui`. `packages/brain` deleted.
- Migration `0104_agent_memory.sql`: `agent_memories`, FTS RPC, RLS.

Web (`apps/web`)
- Session-id addressing + 409 fallback in `channel-bot-eve.ts`,
  `pod-bot-reply.ts` (consume ends on `turn.waiting`, decisions via
  `inputResponses`, `cancel` replaces `deny`), `eve-session.ts`,
  `transcript.ts`, `agent-chat.tsx`, `assistant-chat.tsx`, the assistant
  runner, the actions-MCP park stamp, and the smoke scripts.
- `lib/memory/{store,tools,guest-profile}.ts`; `runBot()` injects memory
  tools; triage + automation suggestions prefetch memory; meetings, triage
  acceptance, and the `action.gbrain.capture` step write memory; guest
  profile side-channel on memory.
- Memory browser (`/p/<pid>/agents/memory`, API, curation actions); fleet
  `/agents/fleet/access`; nav relabelled; agent editor shows memory as
  always-on; calendar copilot searches memory.
- Deleted: `lib/brain/*`, brain routes/UI/cron, brain scripts, `infra/`,
  `tests/gbrain-*`. Docs: `AGENTS.md`, root `CLAUDE.md`, `VERSIONS.md`,
  `OPERATIONS.md`.

## 5. Verification done here, and what still needs a live environment

Done: `pnpm --filter agent typecheck` (0 errors), `cd apps/agent && pnpm
build` (eve compile, 0 diagnostics, memory slots in the manifest), web
`tsc --noEmit` (0 errors), `vitest` (228 passed, 18 env-skipped), eslint on
touched files (only pre-existing warnings remain elsewhere).

Not possible in this checkout (no `.env.local`, no Vercel link, no Docker):
every live harness. Before calling this done in production:

1. Apply migration 0104 to the dev project, then run
   `node --env-file=.env.local scripts/bot-chat-test.mjs suite` and `modes`
   (channel bot on 0.83: resume by id, question park delivered from
   `turn.waiting`, answer routed as `inputResponses`).
2. `scripts/assistant-smoke.mjs` and `assistant-projects-test.mjs`
   (id-addressed follow-ups, project persona, tenancy fences).
3. `scripts/bot-capability-test.mjs --only action/memory-remember` plus the
   `knowledge/*` scenarios (recall block present; `property__search` used).
4. `scripts/fleet-approvals-test.mjs` and `pod-bot-chat-test.mjs` (pod
   approvals now answered with `inputResponses` + `cancel`).
5. First deploy: eve 0.83 generates the Build Output service as before, but
   confirm the Vercel build picks Node 24 and that existing sessions report
   `409` and restart cleanly (expected after a 0.27 → 0.83 jump).
6. Remove the retired env vars from Vercel (`BRAIN_MCP_URL`, `BRAIN_TOKEN_*`,
   `GBRAIN_ADMIN_BOOTSTRAP_TOKEN`) and decommission the Railway services.

## 6. Follow-ups worth doing next (not started)

- **Hybrid memory search**: `agent_memories.embedding` is reserved; add a
  `search_agent_memories_hybrid` RRF function like the chatbot one when a
  property's memory grows past what FTS ranks well.
- **Deferred tools**: the channel bot carries ~40 tools; eve 0.76's
  `deferred: true` + `eve__search` would shrink every request. Measure
  behaviour before switching (the model must learn to search first).
- **Files for real work**: when a background job genuinely needs a
  filesystem (bulk analysis, generated reports), enable `read_file`/
  `write_file` for the virtual bots and mount a per-property Drive snapshot;
  write-back through a short-lived read-write sandbox as the Drives starter
  does.
- **Memory curation UX**: edit-in-place, supersede-with-correction, and a
  per-person "my notes" view on the Assistant surface.
- **Repo hygiene**: `apps/agent/.output` is tracked in git; it is a build
  artifact and should be ignored.


## Phase 2 — AI Elements, streaming panels, the learning loop, mobile (2026-10-23)

- **AI SDK 7 everywhere.** `apps/web` moved from `ai` 6 to 7.0.150 via the
  official codemod (`stepCountIs`→`isStepCount`, `system`→`instructions`,
  `onFinish`→`onEnd`); over-reaches on unrelated `system:` keys were reverted
  by hand. Root and agent now share one `ai` tree.
- **AI Elements** installed into `components/ai-elements/*`; two shared
  renderers (`eve-conversation.tsx` for eve transcripts, `bot-panel-conversation.tsx`
  for `useChat` panels) replace four bespoke transcript renderers.
- **Transport unified** in `hooks/use-eve-session.ts` (web) and
  `apps/mobile/hooks/useEveSession.ts` over the shared reducer in
  `@hotelclaw/chat-ui/transcript`.
- **Panels stream**: `streamBot()` + `useChat`/`DefaultChatTransport` for the
  task assistant and "Ask the numbers".
- **Learning loop**: auto-capture on `turn.completed` (agent), `ai_feedback`
  (0105) + thumbs on every surface, nightly `/api/memory/consolidate`
  (feedback → person preferences deterministically; Haiku merge of `auto`
  memories), correction rule in `MEMORY_DISCIPLINE`.
- **Mobile**: Bearer auth on the eve channel, Assistant screens, task
  assistant sheet, feedback route.

### Verified (no `.env.local` in this checkout, so no live harness)

| Check | Result |
| --- | --- |
| `apps/web` `tsc --noEmit` | 0 errors |
| `apps/agent` `tsc --noEmit` | 0 errors |
| `apps/mobile` `tsc --noEmit` | 0 errors |
| `eve build` | clean, memory slots + tools in manifest |
| `vitest run` (apps/web) | 239 passed, 18 skipped (env-gated) |
| eslint on touched files (web + mobile) | clean |

### Still to run with a live environment

1. Apply migration `0105_ai_feedback.sql`.
2. `scripts/assistant-smoke.mjs` and `scripts/bot-chat-test.mjs suite|stress|parallel`.
3. One manual eve turn on the Assistant: confirm the reasoning disclosure,
   a parked `ask_question` answered through the chips, and that an `auto`
   memory appears in the Memory browser afterwards.
4. Mobile dev client: Assistant chat end-to-end on a device (expo/fetch
   streaming), task sheet on a task.
5. Trigger `/api/memory/consolidate` once by hand with `CRON_SECRET`.
