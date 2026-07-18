-- Internal AI agents (the Agents rail section) — property members create,
-- inspect, and chat with configurable agentic assistants. Behavior lives in
-- `config` as versioned JSON (see lib/agents/schema.ts: instructions, model
-- tier, tool grants from the catalog, SKILL.md-format skills, document
-- resources). Execution happens in the eve runtime (apps/agent), which
-- resolves instructions/tools/skills per session from these rows — the row
-- is the single source of truth, the runtime is stateless about behavior.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  config jsonb not null default '{"version":1}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agents_property_idx on public.agents (property_id, created_at desc);

create trigger agents_touch_updated_at
  before update on public.agents
  for each row execute function public.touch_updated_at();

-- One row per eve chat session, keyed by eve's session id (wrun_…). Exists
-- so the UI can list a user's conversations per agent and continue them
-- (the continuation token is required for follow-up turns). Row writes go
-- through the app server; the eve runtime never touches this table.
create table public.agent_sessions (
  id text primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New session',
  continuation_token text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_sessions_list_idx
  on public.agent_sessions (agent_id, user_id, last_message_at desc);

create trigger agent_sessions_touch_updated_at
  before update on public.agent_sessions
  for each row execute function public.touch_updated_at();

alter table public.agents enable row level security;
alter table public.agent_sessions enable row level security;

-- Any property member can build and manage agents (same deliberate choice
-- as chatbots: transparency and configurability for the whole team).
create policy agents_select on public.agents
  for select using (public.is_member(property_id));
create policy agents_insert on public.agents
  for insert with check (public.is_member(property_id) and created_by = auth.uid());
create policy agents_update on public.agents
  for update using (public.is_member(property_id))
  with check (public.is_member(property_id));
create policy agents_delete on public.agents
  for delete using (public.is_member(property_id));

-- Sessions are personal: only the user who opened one can see or continue
-- it (the continuation token grants the ability to speak as that session).
create policy agent_sessions_select on public.agent_sessions
  for select using (user_id = auth.uid() and public.is_member(property_id));
create policy agent_sessions_insert on public.agent_sessions
  for insert with check (user_id = auth.uid() and public.is_member(property_id));
create policy agent_sessions_update on public.agent_sessions
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy agent_sessions_delete on public.agent_sessions
  for delete using (user_id = auth.uid());
