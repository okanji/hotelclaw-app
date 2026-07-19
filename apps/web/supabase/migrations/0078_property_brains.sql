-- Per-property brain bindings + channel-bot durable sessions.
--
-- property_brains: which source on the SHARED gbrain server a property's
-- Tier-1 bots read/write, and the OAuth client that fences them there.
-- Pod properties don't need a row (they inherit their client's binding via
-- clients.brain_client_secret_ref); this table provisions everyone else.
-- The client secret is AES-256-GCM encrypted at rest (lib/brain/crypto.ts)
-- — never plaintext in rows, dumps, or logs.
--
-- channel_bot_sessions: the default channel bot's durable eve sessions,
-- one per (channel, thread) — the eve migration of lib/stream/ai-reply
-- generation. Also holds `delegate:<sessionId>` rows minted by the
-- delegate_task tool so delegated work is discoverable and its subagents
-- can recover tenant scope (apps/agent tenant.ts fallback).

create table public.property_brains (
  property_id uuid primary key references public.properties(id) on delete cascade,
  source text not null,
  client_id text not null,
  client_secret_enc text not null,
  created_at timestamptz not null default now()
);

alter table public.property_brains enable row level security;
-- Service-role only: no member-facing policies. Credentials never reach
-- the client; reads/writes happen in server code.

create table public.channel_bot_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  channel_id text not null,
  thread_key text not null default '',
  eve_session_id text,
  eve_continuation_token text,
  status text not null default 'idle' check (status in ('idle', 'awaiting_approval')),
  pending_approval jsonb,
  last_turn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, thread_key)
);

create index if not exists channel_bot_sessions_property_idx
  on public.channel_bot_sessions (property_id, last_turn_at desc);

create trigger channel_bot_sessions_touch_updated_at
  before update on public.channel_bot_sessions
  for each row execute function public.touch_updated_at();

alter table public.channel_bot_sessions enable row level security;

-- Members can read their property's sessions (transparency surfaces);
-- writes are service-only, like the fleet tenancy spine.
create policy channel_bot_sessions_select on public.channel_bot_sessions
  for select using (
    exists (
      select 1 from public.memberships m
      where m.property_id = channel_bot_sessions.property_id
        and m.user_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.channel_bot_sessions;
