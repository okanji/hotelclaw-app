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
