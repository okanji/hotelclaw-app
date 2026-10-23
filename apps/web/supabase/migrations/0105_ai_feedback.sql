-- 0105: AI feedback — the learning loop's signal.
--
-- A thumbs up/down (plus an optional note) on an AI reply, from any surface:
-- the Assistant, an agent chat, the task / insights panels. Rows feed two
-- things: (1) the Memory browser's "what people told the AI" view and the
-- deterministic distiller that turns a note into a per-person preference
-- memory (lib/memory/learn.ts), and (2) eval seeds (a 👎 with a note is a
-- test case waiting to be written). Members read their property's feedback;
-- writes go through a server action under the caller's own session.

create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in ('assistant', 'agent', 'task', 'insights', 'document', 'channel')),
  -- Where the reply lives: eve session id for durable surfaces, a route for panels.
  session_id text,
  -- Stable key for the reply inside the surface (turn index or message id).
  message_key text not null,
  rating smallint not null check (rating in (-1, 1)),
  note text check (note is null or char_length(note) <= 1000),
  -- The reply's opening text, so the row reads on its own in the browser.
  excerpt text check (excerpt is null or char_length(excerpt) <= 600),
  -- Set when the distiller has turned this row into a memory (idempotency).
  distilled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ai_feedback_property_idx
  on public.ai_feedback (property_id, created_at desc);
create unique index if not exists ai_feedback_once_idx
  on public.ai_feedback (user_id, surface, coalesce(session_id, ''), message_key);

alter table public.ai_feedback enable row level security;

drop policy if exists "ai_feedback members read" on public.ai_feedback;
create policy "ai_feedback members read"
  on public.ai_feedback for select
  using (public.is_member(property_id));

drop policy if exists "ai_feedback own write" on public.ai_feedback;
create policy "ai_feedback own write"
  on public.ai_feedback for insert
  with check (auth.uid() = user_id and public.is_member(property_id));

drop policy if exists "ai_feedback own update" on public.ai_feedback;
create policy "ai_feedback own update"
  on public.ai_feedback for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
