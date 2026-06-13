-- Chatbots — guest-facing agentic chatbots built by property members (front
-- desk concierge, room-service order-taker, restaurant orders). Guests are
-- NOT app users: conversations flow through a public HMAC-gated API using
-- the service client, never Stream. Bot behavior lives in `config` as
-- versioned JSON (see lib/chatbots/schema.ts), mirroring the forms pattern.
-- Knowledge retrieval is Postgres FTS in v1; the pgvector column is reserved
-- so hybrid retrieval can land later without a rewrite.

-- Supabase installs extensions into the `extensions` schema, which is NOT on
-- the migration role's search_path — qualify every extension function/type.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create table public.chatbots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  -- Unguessable guest URL token (/g/<public_slug>). Regenerable to kill
  -- leaked QR codes; never expose property_id on the guest surface.
  public_slug text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  template text not null default 'custom'
    check (template in ('front_desk', 'room_service', 'restaurant', 'custom')),
  config jsonb not null default '{"version":1}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'paused')),
  -- Cost guardrails: bot replies per day across all conversations, and
  -- guest messages per conversation before a forced handoff offer.
  daily_message_cap int not null default 200,
  session_message_cap int not null default 30,
  last_trained_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chatbots_property_idx on public.chatbots (property_id, created_at desc);

create trigger chatbots_touch_updated_at
  before update on public.chatbots
  for each row execute function public.touch_updated_at();

-- Per-bot knowledge sources (text snippets, Q&A overrides, linked in-app
-- documents snapshotted at train time, pasted URLs fetched at train time).
create table public.chatbot_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('text', 'qa', 'document', 'url')),
  title text not null,
  -- Text snippet body / Q&A answer / document snapshot / fetched page text.
  content text,
  -- Q&A pairs: the question this exact answer covers.
  question text,
  document_id uuid references public.documents(id) on delete set null,
  url text,
  status text not null default 'pending' check (status in ('pending', 'trained', 'failed')),
  error text,
  char_count int not null default 0,
  last_trained_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chatbot_knowledge_sources_bot_idx
  on public.chatbot_knowledge_sources (chatbot_id, created_at desc);

create trigger chatbot_knowledge_sources_touch_updated_at
  before update on public.chatbot_knowledge_sources
  for each row execute function public.touch_updated_at();

-- Retrieval units: ~1.5k-char chunks of trained sources. FTS now; the
-- embedding column stays null until hybrid retrieval ships.
create table public.chatbot_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.chatbot_knowledge_sources(id) on delete cascade,
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  content text not null,
  content_fts tsvector generated always as (to_tsvector('english', content)) stored,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now()
);

create index chatbot_knowledge_chunks_fts_idx
  on public.chatbot_knowledge_chunks using gin (content_fts);
create index chatbot_knowledge_chunks_bot_idx
  on public.chatbot_knowledge_chunks (chatbot_id);

-- Guest conversations. session_token ties an anonymous browser to its
-- conversation (HMAC-signed, stored in localStorage). status drives the
-- handoff state machine: 'human' structurally mutes the bot — the message
-- route checks it BEFORE generation.
create table public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  session_token text not null,
  channel text not null default 'web' check (channel in ('web', 'test')),
  guest_name text,
  guest_email text,
  guest_phone text,
  room_number text,
  status text not null default 'bot' check (status in ('bot', 'human', 'closed')),
  outcome text not null default 'open'
    check (outcome in ('open', 'resolved', 'order_placed', 'escalated', 'unresolved')),
  outcome_meta jsonb not null default '{}'::jsonb,
  message_count int not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index chatbot_conversations_session_idx
  on public.chatbot_conversations (chatbot_id, session_token);
create index chatbot_conversations_bot_idx
  on public.chatbot_conversations (chatbot_id, last_message_at desc nulls last);
create index chatbot_conversations_property_idx
  on public.chatbot_conversations (property_id, last_message_at desc nulls last);

create trigger chatbot_conversations_touch_updated_at
  before update on public.chatbot_conversations
  for each row execute function public.touch_updated_at();

create table public.chatbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chatbot_conversations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  role text not null check (role in ('guest', 'bot', 'staff', 'system')),
  content text not null,
  -- runGuestBot trace (tool calls + results) for the transcript inspector.
  tool_calls jsonb,
  tokens int,
  created_at timestamptz not null default now()
);

create index chatbot_messages_conversation_idx
  on public.chatbot_messages (conversation_id, created_at);

-- Daily budget source of truth (Redis mirrors it for the hot pre-generation
-- check; this row settles the truth).
create table public.chatbot_usage_daily (
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  day date not null,
  messages int not null default 0,
  tokens int not null default 0,
  primary key (chatbot_id, day)
);

create index chatbot_usage_daily_property_idx
  on public.chatbot_usage_daily (property_id, day desc);

-- Atomic increment for the message route (service client).
create or replace function public.increment_chatbot_usage(
  p_chatbot_id uuid,
  p_property_id uuid,
  p_day date,
  p_messages int,
  p_tokens int
) returns int
language sql
as $$
  insert into public.chatbot_usage_daily (chatbot_id, property_id, day, messages, tokens)
  values (p_chatbot_id, p_property_id, p_day, p_messages, p_tokens)
  on conflict (chatbot_id, day)
  do update set
    messages = public.chatbot_usage_daily.messages + excluded.messages,
    tokens = public.chatbot_usage_daily.tokens + excluded.tokens
  returning messages;
$$;

-- FTS retrieval for the search_knowledge tool: websearch query, rank-ordered.
create or replace function public.search_chatbot_chunks(
  p_chatbot_id uuid,
  p_query text,
  p_limit int default 6
) returns table (content text, source_title text, rank real)
language sql stable
as $$
  select
    c.content,
    s.title as source_title,
    ts_rank(c.content_fts, websearch_to_tsquery('english', p_query)) as rank
  from public.chatbot_knowledge_chunks c
  join public.chatbot_knowledge_sources s on s.id = c.source_id
  where c.chatbot_id = p_chatbot_id
    and c.content_fts @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

alter table public.chatbots enable row level security;
alter table public.chatbot_knowledge_sources enable row level security;
alter table public.chatbot_knowledge_chunks enable row level security;
alter table public.chatbot_conversations enable row level security;
alter table public.chatbot_messages enable row level security;
alter table public.chatbot_usage_daily enable row level security;

-- Any property member can build and manage chatbots (deliberate: this
-- feature is for the whole team, not just owners/managers).
create policy chatbots_select on public.chatbots
  for select using (public.is_member(property_id));
create policy chatbots_insert on public.chatbots
  for insert with check (public.is_member(property_id) and created_by = auth.uid());
create policy chatbots_update on public.chatbots
  for update using (public.is_member(property_id))
  with check (public.is_member(property_id));
create policy chatbots_delete on public.chatbots
  for delete using (public.is_member(property_id));

create policy chatbot_knowledge_sources_all on public.chatbot_knowledge_sources
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy chatbot_knowledge_chunks_select on public.chatbot_knowledge_chunks
  for select using (public.is_member(property_id));

-- Conversations + messages: members read (transcripts, escalation viewer).
-- All guest-side writes go through the public API with the service client,
-- which bypasses RLS — anon gets nothing.
create policy chatbot_conversations_select on public.chatbot_conversations
  for select using (public.is_member(property_id));

create policy chatbot_messages_select on public.chatbot_messages
  for select using (public.is_member(property_id));

create policy chatbot_usage_daily_select on public.chatbot_usage_daily
  for select using (public.is_member(property_id));

-- Staff conversation viewer gets live guest messages + status flips.
alter publication supabase_realtime add table public.chatbot_conversations;
alter publication supabase_realtime add table public.chatbot_messages;
