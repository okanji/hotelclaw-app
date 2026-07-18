-- Pod tenancy spine (Hotelclaw fleet spec M1) — ADDITIVE to the existing
-- property-centric schema. A "client" (= pod) groups properties under one
-- knowledge brain + one eve tenancy scope. Existing single-property demo
-- data keeps working: properties.client_id is nullable, and everything
-- property-scoped continues to key on property_id.
--
-- Naming adaptations from the spec (spec said: adjust to what exists):
--   spec `properties` table  -> existing public.properties (added client_id,
--                               timezone; slug already existed)
--   spec `bots` table        -> public.bots (client-scoped pod bots; the
--                               in-app Agents section's `agents` table stays
--                               property-scoped and separate — unification
--                               is an M2/M3 concern)
--   spec `chats` alterations -> public.bot_chat_sessions (the app's chat is
--                               Stream, there is no chats table; this maps
--                               Stream channel × bot -> eve session)

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  -- Pod brain MCP endpoint. The TOKEN is never stored here: brain_token_ref
  -- names an env var / secret-store key the server resolves at runtime.
  brain_url text not null default '',
  brain_token_ref text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'offboarded')),
  created_at timestamptz not null default now()
);

alter table public.properties
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists timezone text not null default 'Africa/Nairobi';

create index if not exists properties_client_idx on public.properties (client_id);

-- Pod bots: one row per (client, bot slug). bot_id matches the pod brain's
-- playbooks/<property-slug>/<bot_id>.md compiled-truth pages.
create table public.bots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bot_id text not null,
  display_name text not null,
  -- Static instructions used when the brain persona resolver returns null
  -- (brain outage or unseeded playbook) — degradation, not outage.
  persona_fallback text,
  -- Allow-list of authored eve tool names for this bot's sessions.
  tool_set text[] not null default '{}',
  model_tier text not null default 'standard' check (model_tier in ('standard', 'advanced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, bot_id)
);

create trigger bots_touch_updated_at
  before update on public.bots
  for each row execute function public.touch_updated_at();

-- Stream channel × bot -> durable eve session mapping. One live session per
-- (channel, bot); the continuation token is required to send the next turn
-- and is refreshed after every turn.
create table public.bot_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel_id text not null,
  eve_session_id text,
  eve_continuation_token text,
  last_turn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, bot_id)
);

create trigger bot_chat_sessions_touch_updated_at
  before update on public.bot_chat_sessions
  for each row execute function public.touch_updated_at();

-- Membership of a client = membership of any of its properties.
create or replace function public.is_client_member(cli_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.properties p on p.id = m.property_id
    where p.client_id = cli_id and m.user_id = auth.uid()
  );
$$;

alter table public.clients enable row level security;
alter table public.bots enable row level security;
alter table public.bot_chat_sessions enable row level security;

-- Reads: members of the client. Writes: operator tooling only (service
-- role bypasses RLS; no member-facing write policies on the tenancy spine).
create policy clients_select on public.clients
  for select using (public.is_client_member(id));
create policy bots_select on public.bots
  for select using (public.is_client_member(client_id));
create policy bot_chat_sessions_select on public.bot_chat_sessions
  for select using (public.is_client_member(client_id));
