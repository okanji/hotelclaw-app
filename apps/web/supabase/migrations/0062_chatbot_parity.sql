-- Chatbots Phase 4/5 — Chatbase-parity features:
--   • chatbot_custom_actions: user-defined HTTP actions the bot can call
--     (header values encrypted at the app layer — see lib/chatbots/crypto.ts)
--   • allowed_domains: widget-embed allowlist (drives frame-ancestors CSP)
--   • twilio_number: per-bot WhatsApp/SMS number; conversations gain the
--     matching channels
--   • feedback: guest thumbs up/down on bot messages
--   • search_chatbot_chunks_hybrid: vector + FTS reciprocal-rank-fusion
--     retrieval, used when an embeddings provider is configured

create table public.chatbot_custom_actions (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  -- Natural-language trigger guidance, appended to the tool description.
  when_to_use text,
  method text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'DELETE')),
  url text not null,
  -- [{ name, value_encrypted }] — values AES-256-GCM encrypted app-side.
  headers jsonb not null default '[]'::jsonb,
  -- Optional JSON body template with {{param}} placeholders (POST/PUT/DELETE).
  body_template text,
  -- [{ id, name, type: 'string'|'number'|'boolean', description, required }]
  param_schema jsonb not null default '[]'::jsonb,
  -- Dot-paths the model may see from the response ("data.price"); [] = full.
  response_allowlist jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chatbot_custom_actions_bot_idx
  on public.chatbot_custom_actions (chatbot_id, created_at);

create trigger chatbot_custom_actions_touch_updated_at
  before update on public.chatbot_custom_actions
  for each row execute function public.touch_updated_at();

alter table public.chatbot_custom_actions enable row level security;
create policy chatbot_custom_actions_all on public.chatbot_custom_actions
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

-- Widget embed: domains allowed to iframe the guest page. Empty = link-only.
alter table public.chatbots
  add column allowed_domains text[] not null default '{}';

-- WhatsApp/SMS: the Twilio number guests text ('whatsapp:+1415…' or '+1415…').
alter table public.chatbots add column twilio_number text;
create unique index chatbots_twilio_number_idx
  on public.chatbots (twilio_number)
  where twilio_number is not null;

alter table public.chatbot_conversations
  drop constraint chatbot_conversations_channel_check;
alter table public.chatbot_conversations
  add constraint chatbot_conversations_channel_check
  check (channel in ('web', 'test', 'whatsapp', 'sms'));

-- Guest thumbs on bot replies (-1 / 1).
alter table public.chatbot_messages
  add column feedback smallint check (feedback in (-1, 1));

-- Hybrid retrieval: RRF-merge FTS rank with cosine similarity over the
-- chunk embeddings. Falls back gracefully — rows without embeddings simply
-- don't contribute to the vector arm. Operators from the extensions schema
-- must be qualified (search_path doesn't include it during migrations).
create or replace function public.search_chatbot_chunks_hybrid(
  p_chatbot_id uuid,
  p_query text,
  p_embedding extensions.vector(1536),
  p_limit int default 6
) returns table (content text, source_title text, rank real)
language sql stable
as $$
  with fts as (
    select c.id,
           row_number() over (
             order by ts_rank(c.content_fts, websearch_to_tsquery('english', p_query)) desc
           ) as rn
    from public.chatbot_knowledge_chunks c
    where c.chatbot_id = p_chatbot_id
      and c.content_fts @@ websearch_to_tsquery('english', p_query)
    limit 20
  ),
  vec as (
    select c.id,
           row_number() over (
             order by c.embedding operator(extensions.<=>) p_embedding
           ) as rn
    from public.chatbot_knowledge_chunks c
    where c.chatbot_id = p_chatbot_id
      and c.embedding is not null
    limit 20
  ),
  merged as (
    select coalesce(f.id, v.id) as id,
           coalesce(1.0 / (60 + f.rn), 0) + coalesce(1.0 / (60 + v.rn), 0) as score
    from fts f
    full outer join vec v using (id)
  )
  select c.content, s.title as source_title, m.score::real as rank
  from merged m
  join public.chatbot_knowledge_chunks c on c.id = m.id
  join public.chatbot_knowledge_sources s on s.id = c.source_id
  order by m.score desc
  limit p_limit;
$$;
