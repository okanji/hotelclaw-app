-- 0104: property memory — the eve-native replacement for the gbrain server.
--
-- One table holds every durable fact a property's people and bots save:
--   subject_kind 'property' → shared institutional memory (recalled into
--                              every bot session of the property)
--   subject_kind 'user'     → one person's preferences/working notes
--   subject_kind 'guest'    → the guest-profile side-channel (subject_id is a
--                              hash of phone/email — never the raw identifier)
--
-- Reads partition by (property_id, subject_kind, subject_id) and the eve
-- memory provider locks that scope per turn from VERIFIED session auth — the
-- model never names a scope. Members may SELECT their property's rows (the
-- Memory browser); every write is service-role (tools + deterministic app
-- writers). Rows are never hard-deleted by the runtime: `superseded_at`
-- retires a fact (leaves recall/search, stays for audit).
--
-- Search is Postgres FTS (`search_agent_memories`) with a word-match
-- fallback in the app layer. `embedding` is reserved for a hybrid upgrade
-- (pgvector already exists from 0061); nothing writes it yet.

create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('property', 'user', 'guest')),
  subject_id text not null check (char_length(subject_id) between 1 and 120),
  kind text not null default 'fact'
    check (kind in ('fact', 'preference', 'event', 'outcome', 'playbook')),
  content text not null check (char_length(content) between 1 and 2000),
  source text check (source is null or char_length(source) <= 200),
  tags text[] not null default '{}',
  importance smallint not null default 2 check (importance between 1 and 3),
  pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_via text not null default 'agent'
    check (created_via in ('agent', 'app', 'member', 'import')),
  superseded_at timestamptz,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(content, '') || ' ' || coalesce(source, '') || ' ' || array_to_string(tags, ' ')
    )
  ) stored
);

create index if not exists agent_memories_scope_idx
  on public.agent_memories (property_id, subject_kind, subject_id, created_at desc)
  where superseded_at is null;
create index if not exists agent_memories_pinned_idx
  on public.agent_memories (property_id, subject_kind, subject_id)
  where superseded_at is null and pinned;
create index if not exists agent_memories_tsv_idx
  on public.agent_memories using gin (tsv);

create or replace function public.touch_agent_memories_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_memories_touch on public.agent_memories;
create trigger agent_memories_touch
  before update on public.agent_memories
  for each row execute function public.touch_agent_memories_updated_at();

alter table public.agent_memories enable row level security;

-- Members read their property's memory (the Memory browser + transparency
-- panels). Guest-subject rows are included on purpose: staff curate them.
drop policy if exists "agent_memories members read" on public.agent_memories;
create policy "agent_memories members read"
  on public.agent_memories for select
  using (public.is_member(property_id));
-- No member write policies: tools and app writers use the service role.

-- Relevance-ranked search inside ONE scope. websearch_to_tsquery accepts
-- natural phrasing ("walk-in freezer alarm"); ties break on pinned, then
-- importance, then recency. Returns the row shape the store reads.
create or replace function public.search_agent_memories(
  p_property_id uuid,
  p_subject_kind text,
  p_subject_id text,
  p_query text,
  p_limit integer default 8
)
returns setof public.agent_memories
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq
  )
  select m.*
  from public.agent_memories m, q
  where m.property_id = p_property_id
    and m.subject_kind = p_subject_kind
    and m.subject_id = p_subject_id
    and m.superseded_at is null
    and q.tsq @@ m.tsv
  order by
    ts_rank_cd(m.tsv, q.tsq) desc,
    m.pinned desc,
    m.importance desc,
    m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

-- Service role only: the function is security definer over an RLS table and
-- takes the scope as arguments, so it must never be callable by end users.
revoke all on function public.search_agent_memories(uuid, text, text, text, integer) from public;
revoke all on function public.search_agent_memories(uuid, text, text, text, integer) from anon;
revoke all on function public.search_agent_memories(uuid, text, text, text, integer) from authenticated;
grant execute on function public.search_agent_memories(uuid, text, text, text, integer) to service_role;

-- Per-person bounded notes document (eve's file-memory shape) — reserved
-- for a future `person` slot backed by fileMemory({ backend }); unused today.
create table if not exists public.agent_memory_documents (
  key text primary key,
  property_id uuid references public.properties(id) on delete cascade,
  content text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.agent_memory_documents enable row level security;
