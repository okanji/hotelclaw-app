-- Event-driven chat delivery (agent/channels/eve.ts `events` handlers).
--
-- The eve runtime now DELIVERS channel-bot replies itself (per eve's channel
-- doctrine: event handlers "deliver completed messages back to the surface
-- that owns this channel") instead of the webhook function holding a
-- connection open until the turn parks. Handlers run inside workflow steps,
-- potentially on different instances per step, so the per-turn accumulator
-- must be DURABLE — it lives on the session row:
--
--   channel_type    — 'team' | 'messaging'; stamped by the web glue so the
--                     runtime can address the Stream channel for posting.
--   turn_nonce      — the [turn <uuid>] marker of the web-initiated turn
--                     currently accumulating. Reset on each nonce-prefixed
--                     message.received; turns WITHOUT a nonce (fleet
--                     approval decisions) never accumulate or deliver.
--   reply_candidate — last message.completed text of the turn (last wins,
--                     matching consumeTurnStream's semantics).
--   ui_spec         — ai_ui_spec captured from a render_ui action.result.
--   delivered_nonce — idempotency: session.waiting delivers at most once
--                     per nonce (replayed steps re-fire handlers).

alter table public.channel_bot_sessions
  add column channel_type    text not null default 'team'
    check (channel_type in ('team', 'messaging')),
  add column turn_nonce      text,
  add column reply_candidate text,
  add column ui_spec         jsonb,
  add column delivered_nonce text;

-- Handlers resolve the row from ctx.session.id.
create index channel_bot_sessions_eve_session_idx
  on public.channel_bot_sessions (eve_session_id);
