-- Activity feed for channel-bot turns.
--
-- 0095 added channel_bot_sessions.turn_activity — a single label, overwritten
-- on every step and discarded when the turn ends. That answers "what is it
-- doing right now" but not "what did it do", which is the transparency
-- pattern every comparable product converges on (Anthropic: "prioritize
-- transparency by explicitly showing the agent's planning steps"; ClickUp's
-- timestamped per-agent entries; the activity-feed pattern in agent-UX
-- writeups).
--
-- This is the append-only log behind it. A row per step, so the chat can show
-- a timestamped list while the turn runs and keep it as an expandable
-- disclosure under the reply afterwards.
--
-- Append-only INSERT rather than a jsonb array on the session row on purpose:
-- eve channel handlers run as durable workflow steps, potentially on
-- different instances and concurrently for parallel tool batches, so a
-- read-modify-write on an array would drop entries.

create table public.channel_bot_activity (
  id           uuid primary key default extensions.gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  channel_id   text not null,
  thread_key   text not null default '_root',
  -- The turn this step belongs to (channel_bot_sessions.turn_nonce), so a
  -- reply can show exactly its own steps.
  turn_nonce   text not null,
  label        text not null,
  created_at   timestamptz not null default now()
);

create index channel_bot_activity_turn_idx
  on public.channel_bot_activity (channel_id, thread_key, turn_nonce, created_at);

-- Housekeeping: the feed is a UI affordance, not an audit log. This index
-- makes the age-based sweep cheap if one is ever added.
create index channel_bot_activity_created_idx
  on public.channel_bot_activity (created_at);

alter table public.channel_bot_activity enable row level security;

-- Same shape as channel_bot_sessions_select: members read their property's
-- activity; writes are service-only.
create policy channel_bot_activity_select on public.channel_bot_activity
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = channel_bot_activity.property_id
        and m.user_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.channel_bot_activity;
