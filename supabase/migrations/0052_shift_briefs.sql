-- Shift briefs — the personal "since your last shift" brief. One row per
-- (property, user) doing double duty: `last_seen_at` is the user's catch-up
-- cursor (advanced by "Mark caught up"), and the rest is the cached brief —
-- a deterministic gathered payload the UI renders directly plus a short
-- Haiku-written orientation paragraph, fingerprint-cached so the model runs
-- only when the underlying facts move.

create table public.shift_briefs (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  summary_md text,
  fingerprint text,
  generated_at timestamptz,
  primary key (property_id, user_id)
);

alter table public.shift_briefs enable row level security;

-- Each member reads their own brief only; writes go through the
-- service-role client (route + generator).
create policy shift_briefs_select on public.shift_briefs
  for select using (user_id = auth.uid());

-- Publish so a freshly generated brief pushes to the open Home page
-- (stale-while-revalidate, mirroring insight_briefs).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shift_briefs'
  ) then
    alter publication supabase_realtime add table public.shift_briefs;
  end if;
end $$;
