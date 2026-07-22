-- G3 "AI trainer" v1 — the feedback + review loop on daily-ops routines:
-- staff flag "this doesn't work" while doing the work; managers get a
-- "review suggested" nudge when flags accumulate or a routine hasn't been
-- looked at in 90 days, and stamp it reviewed. Deterministic on purpose —
-- the AI-rewrite step can ride on top later.

create table public.routine_feedback (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  -- Optional: which checklist item the note is about.
  item_id text,
  note text not null check (char_length(note) between 1 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

create index routine_feedback_routine_idx
  on public.routine_feedback (routine_id, resolved_at);

alter table public.routine_feedback enable row level security;

create policy "routine_feedback_select_member" on public.routine_feedback
  for select using (public.is_member(property_id));
create policy "routine_feedback_insert_member" on public.routine_feedback
  for insert with check (public.is_member(property_id));
create policy "routine_feedback_update_member" on public.routine_feedback
  for update using (public.is_member(property_id));

-- The review stamp ("we relooked at this SOP").
alter table public.routines
  add column reviewed_at timestamptz;
