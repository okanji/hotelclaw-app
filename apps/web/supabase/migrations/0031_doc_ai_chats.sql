-- Persistent AI chats for documents.
--
-- The document assistant (see lib/ai/bots/doc-bot.ts + the bottom dock in
-- components/documents/document-ai-panel.tsx) used to keep its conversation in
-- React state only — lost on refresh, one session at a time. These tables give
-- each document multiple named, persistent chats with full message history.
--
-- A chat belongs to a document; messages belong to a chat. `edit` stores the
-- ProposedDocEdit JSON when the assistant staged a document change, so the
-- "Re-apply" / inline-diff affordance survives a reload.

create table public.doc_ai_chats (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  -- Denormalized for RLS (membership is per-property) and cheap filtering.
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  -- Derived from the first user message; null until the first turn.
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.doc_ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.doc_ai_chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- ProposedDocEdit ({ op, mode, html }) when the assistant staged an edit.
  edit jsonb,
  created_at timestamptz not null default now()
);

-- Chat list for a document, most recently active first.
create index doc_ai_chats_document_recent_idx
  on public.doc_ai_chats (document_id, updated_at desc);

-- Messages of a chat in order.
create index doc_ai_messages_chat_idx
  on public.doc_ai_messages (chat_id, created_at);

-- Reuse the shared trigger from 0001_init.sql.
create trigger doc_ai_chats_set_updated_at
  before update on public.doc_ai_chats
  for each row execute function public.set_updated_at();

alter table public.doc_ai_chats enable row level security;
alter table public.doc_ai_messages enable row level security;

-- Chats: any property member can read/create/update/delete their property's
-- document chats.
create policy "doc_ai_chats_select_member" on public.doc_ai_chats
  for select using (public.is_member(property_id));
create policy "doc_ai_chats_insert_member" on public.doc_ai_chats
  for insert with check (public.is_member(property_id));
create policy "doc_ai_chats_update_member" on public.doc_ai_chats
  for update using (public.is_member(property_id));
create policy "doc_ai_chats_delete_member" on public.doc_ai_chats
  for delete using (public.is_member(property_id));

-- Messages: gated through the parent chat's property membership.
create policy "doc_ai_messages_select_member" on public.doc_ai_messages
  for select using (
    exists (
      select 1 from public.doc_ai_chats c
      where c.id = chat_id and public.is_member(c.property_id)
    )
  );
create policy "doc_ai_messages_insert_member" on public.doc_ai_messages
  for insert with check (
    exists (
      select 1 from public.doc_ai_chats c
      where c.id = chat_id and public.is_member(c.property_id)
    )
  );
create policy "doc_ai_messages_delete_member" on public.doc_ai_messages
  for delete using (
    exists (
      select 1 from public.doc_ai_chats c
      where c.id = chat_id and public.is_member(c.property_id)
    )
  );

-- Realtime: the dock subscribes so new chats / messages appear across the
-- user's own tabs (and collaborators) without polling.
alter publication supabase_realtime add table public.doc_ai_chats;
alter publication supabase_realtime add table public.doc_ai_messages;
