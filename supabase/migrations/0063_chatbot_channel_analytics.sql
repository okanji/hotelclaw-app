-- Chatbots final roadmap batch:
--   • chatbot_channel_deployments — a custom bot deployed into a staff
--     Stream channel: the channel bot answers there with the custom bot's
--     persona, knowledge base, and custom API actions (one bot per channel)
--   • topic/sentiment on conversations — Haiku-classified lazily when the
--     Analytics tab loads, cached on the row (no re-classification)

create table public.chatbot_channel_deployments (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  stream_channel_id text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index chatbot_channel_deployments_bot_idx
  on public.chatbot_channel_deployments (chatbot_id);

alter table public.chatbot_channel_deployments enable row level security;
create policy chatbot_channel_deployments_all on public.chatbot_channel_deployments
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

alter table public.chatbot_conversations
  add column topic text,
  add column sentiment text check (sentiment in ('positive', 'neutral', 'negative'));
