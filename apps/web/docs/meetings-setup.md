# Stream Video meetings — one-time setup

These steps configure the Stream app for the meeting + transcription feature
shipped in migration `0016_meetings.sql`. They only need to run once per
environment.

## 1. Apply the migration

```bash
pnpm supabase db push          # local + remote
# or, for remote only:
pnpm supabase migration up
```

## 2. Set `XAI_API_KEY`

The summarization worker uses `grok-4-fast-non-reasoning-latest` via
`@ai-sdk/xai`. Add to `.env.local`
(dev) and the platform's secret store (prod):

```
XAI_API_KEY=xai-...
```

The key is read lazily by `lib/ai/providers.ts`. Routes unrelated to
summarization stay green even if it's unset; the webhook handler logs a
failure and skips the summary, leaving the transcript persisted.

## 3. Configure the `default` call type for auto-transcription

Stream's `default` call type powers meetings. By default transcription is
`available` (clients must call `startTranscription()`) — the meeting
context already does that on join, so this is technically optional. Setting
the call type to `auto-on` makes transcription start with the call even if
a future code path forgets to call the method.

Run from the project root with the Stream CLI authenticated against the
right app:

```bash
stream api UpdateCallType name=default --body '{
  "settings": {
    "transcription": {
      "language": "en",
      "mode": "auto-on",
      "closed_caption_mode": "auto-on"
    }
  }
}'
```

Verify with:

```bash
stream api GetCallType name=default
```

## 4. Register the webhook URL

The transcript pipeline depends on Stream calling
`/api/stream/webhook/call` with `call.transcription_ready` and
`call.session_ended` events.

Set the URL in the Stream dashboard (App → Video & Audio → Webhooks)
**or** via API:

```bash
stream api UpdateApp --body '{
  "webhook_url": "https://<your-host>/api/stream/webhook/call",
  "webhook_events": [
    "call.transcription_ready",
    "call.session_ended"
  ]
}'
```

Local development: expose the dev server through `ngrok`/`cloudflared` and
point Stream at the public URL. Stream signs every webhook with
HMAC-SHA256 in the `x-signature` header — the handler verifies via
`verifyAndParseWebhook` from `@stream-io/node-sdk`, so an unsigned or
tampered body never reaches the database.

## 5. Smoke test

1. Open a channel as user A in Chrome.
2. Open the same channel as user B in another browser (incognito or a
   second profile).
3. User A clicks **Meet** in the channel header → preview screen → Join.
4. User B's button still says **Meet** (the meeting is per-channel; B joins
   the same call by clicking it).
5. Both users see the "Transcribing" pill.
6. Either user clicks Leave.
7. ~30s after the second leave, the channel receives a system message:
   `📝 Meeting summary: …` with action items and decisions. A new
   document also appears in the property's docs tree.

If the summary doesn't arrive, check:
- `meetings` row exists with `ended_at` set
- `meeting_transcripts` row exists with `status='fetched'`
- Server logs for `processTranscriptReady failed` or
  `Grok summarization failed`
- `XAI_API_KEY` is set in the deployed environment
