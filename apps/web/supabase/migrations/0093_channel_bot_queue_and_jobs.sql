-- Lossless conversation queue + detached background jobs for the channel
-- bot — the eve-docs-prescribed shape (execution-model-and-durability.md,
-- "Message delivery and queueing"): "If your channel can receive bursts
-- while the agent is working, keep your own per-session queue in the
-- channel or app layer, then deliver the next message after the session
-- parks again. Separate sessions still run independently."
--
-- Three pieces:
--   1. turn_state/turn_started_at — a crash-safe Postgres CLAIM replacing
--      the Redis TTL lock. The webhook atomically claims idle→running; a
--      turn stuck running past the staleness cutoff is reclaimable.
--   2. channel_bot_queue — messages arriving while a turn runs. Drained
--      into the next turn by the runtime the moment the session parks
--      (session.waiting carries the fresh continuation token), or by the
--      next webhook turn as a fallback. Nothing is ever dropped.
--   3. kind='job' rows — detached background-job sessions ("separate
--      sessions still run independently"): the start_background_job tool
--      creates an independent eve session per heavy task; its result is
--      delivered by the same events machinery, prefixed with job_headline.

alter table public.channel_bot_sessions
  add column turn_state      text not null default 'idle'
    check (turn_state in ('idle', 'running')),
  add column turn_started_at timestamptz,
  add column kind            text not null default 'chat'
    check (kind in ('chat', 'job')),
  add column job_headline    text;

create table public.channel_bot_queue (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  channel_id   text not null,
  thread_key   text not null default '_root',
  -- {messageId, text, userId, userName, activationReason}
  message      jsonb not null,
  created_at   timestamptz not null default now()
);

create index channel_bot_queue_channel_idx
  on public.channel_bot_queue (channel_id, thread_key, created_at);

alter table public.channel_bot_queue enable row level security;
-- Service-client only (webhook writes, runtime drains); members never
-- touch this table directly.
