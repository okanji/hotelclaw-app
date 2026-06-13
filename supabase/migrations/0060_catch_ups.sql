-- Catch-up summaries — "what changed here since you last looked", per user
-- per project/space. Same double-duty row shape as shift_briefs: the cursor
-- (`last_seen_at`, advanced by "Mark read") plus the cached deterministic
-- payload and the Haiku one-liner, fingerprinted so the model runs only
-- when the entity actually moved.

create table public.catch_ups (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('project','space')),
  subject_id uuid not null,
  last_seen_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  summary_md text,
  fingerprint text,
  generated_at timestamptz,
  primary key (property_id, user_id, subject_kind, subject_id)
);

alter table public.catch_ups enable row level security;

-- Own rows only; writes via the service-role generator/route.
create policy catch_ups_select on public.catch_ups
  for select using (user_id = auth.uid());
