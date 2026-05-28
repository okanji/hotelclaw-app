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
- `pnpm dev` running on `localhost:3000`
- `ngrok` tunnel up, Stream webhook event-hook pointing at `<ngrok>/api/stream/webhook/message-new`
- `.env.local` has `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `STREAM_API_SECRET`

If ngrok URL has rotated since last setup, resync Stream's hook:

```bash
node --env-file=.env.local -e "const{StreamChat}=require('stream-chat');(async()=>{const url=(await(await fetch('http://127.0.0.1:4040/api/tunnels')).json()).tunnels[0].public_url+'/api/stream/webhook/message-new';const c=StreamChat.getInstance(process.env.NEXT_PUBLIC_STREAM_API_KEY,process.env.STREAM_API_SECRET);const h=(await c.getAppSettings()).app.event_hooks;await c.updateAppSettings({event_hooks:h.map(x=>x.event_types.includes('message.new')?{...x,webhook_url:url}:x)});console.log('updated → '+url)})();"
```

**When the harness fails**, the failure mode + classifier reason in `/tmp/hotelclaw-dev.log` (`[ai-trigger:*]` lines) tells you what the bot decided and why. Treat failures as real bugs — most have surfaced root issues (PostgREST joins, history-pattern mimicry, race conditions, classifier prompt drift) rather than test-harness flakiness.

The harness writes real Stream messages to `prop-697681e8-food-and-beverage-5d05af` as a test user (`bot-tester`). Use `--channel <id>` to target a different one.

# Two-tier AI architecture — read before adding a new bot or AI capability

This app has a **two-tier AI architecture** (plan: `~/.claude/plans/breezy-noodling-turing.md`). Know which tier your change belongs in before you write code.

## Tier 1 — In-app bots (live in this repo)

Many lightweight, purpose-specific bots, each scoped to a single feature surface:
- **Channel bot** — `lib/stream/ai-reply.ts` (built)
- **Liveblocks comment bot** — `lib/ai/bot-scaffold.ts` (built)
- **Task detail bot** — `lib/ai/bots/task-bot.ts` + `app/api/properties/[propertyId]/tasks/[taskId]/ai/route.ts` + `components/tasks/task-ai-panel.tsx` (built)
- **Document bot** — `lib/ai/bots/doc-bot.ts` + `app/api/properties/[propertyId]/documents/[documentId]/ai/route.ts` + `components/documents/document-ai-panel.tsx` (built, read-only Q&A; inline write actions like `/ai`-slash and floating-toolbar Rewrite still planned)
- **Calendar AI** — Liveblocks Copilot wired in `components/calendar/calendar-ai-panel.tsx` (built — uses Liveblocks's `AiChat` rather than `runBot()`, since it lives inside a Liveblocks room)
- Search bot / Onboarding bot — planned

**Adding a new in-app bot:** create `lib/ai/bots/<name>-bot.ts` with a persona + scoped tool set, call `runBot()` from `lib/ai/run-bot.ts`. Don't reinvent prompt assembly, model settings, or tool wiring — the runtime handles it (gbrain tools and `delegate_to_openclaw` are auto-injected; activation-reason handling, deferral-guard, temperature/stopWhen settings are uniform across bots). Wire your bot to a Next.js API route and a client component on its surface.

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
