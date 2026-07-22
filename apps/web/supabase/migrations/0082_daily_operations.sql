-- Daily operations (B3) — the recurring layer the PO separates from finite
-- projects: "housekeeping just runs every day; a project starts and ends."
--
-- `routines` = a team's recurring checklist (opening/closing/handover…),
-- defined once with jsonb items and the weekdays it runs. `routine_runs` =
-- one row per (routine, date), created lazily the first time someone opens
-- that day's ops; holds which item ids are checked, when everything was
-- done, and the evening manager sign-off ("has the day been done?"). The
-- run row is the audit trail the evaluation layer (D2) will rate later.

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- [{id, label}] — item ids are stable slugs so runs survive relabeling
  items jsonb not null default '[]'::jsonb,
  -- Weekdays it runs: 0=Sunday … 6=Saturday
  days smallint[] not null default '{0,1,2,3,4,5,6}',
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index routines_space_idx on public.routines (space_id, archived_at);
create index routines_property_idx on public.routines (property_id);

create table public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  run_date date not null,
  -- checked item ids (subset of the routine's items at check time)
  done_items jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  signed_off_by uuid references auth.users(id) on delete set null,
  signed_off_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (routine_id, run_date)
);

create index routine_runs_property_date_idx
  on public.routine_runs (property_id, run_date);

alter table public.routines enable row level security;
alter table public.routine_runs enable row level security;

-- Ordinary member data — same policy shape as tasks.
create policy "routines_select_member" on public.routines
  for select using (public.is_member(property_id));
create policy "routines_insert_member" on public.routines
  for insert with check (public.is_member(property_id));
create policy "routines_update_member" on public.routines
  for update using (public.is_member(property_id));
create policy "routines_delete_member" on public.routines
  for delete using (public.is_member(property_id));

create policy "routine_runs_select_member" on public.routine_runs
  for select using (public.is_member(property_id));
create policy "routine_runs_insert_member" on public.routine_runs
  for insert with check (public.is_member(property_id));
create policy "routine_runs_update_member" on public.routine_runs
  for update using (public.is_member(property_id));
create policy "routine_runs_delete_member" on public.routine_runs
  for delete using (public.is_member(property_id));
