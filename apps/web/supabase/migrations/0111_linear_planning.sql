-- Linear-parity planning layer (2026-10-25): triage queue, cycles + estimates,
-- milestone progress, initiatives, and written status updates.
--
-- A side-by-side with Linear's public demo workspace surfaced the gaps; each
-- block below closes one. Everything is additive — no existing column changes
-- meaning, and every new task column is nullable, so mobile and older web
-- builds keep working untouched.

-- ── Tasks: estimate, cycle, milestone, triage ────────────────────────────────

-- Cycles first (tasks.cycle_id references it).
create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- The team that runs this cadence. NULL = a property-wide cycle (tasks with
  -- no team can still be planned).
  space_id uuid references public.spaces(id) on delete cascade,
  -- Sequential per (property, team): "Cycle 12".
  number integer not null check (number > 0),
  name text check (name is null or char_length(name) between 1 and 80),
  -- Inclusive date range in the property's local calendar.
  starts_on date not null,
  ends_on date not null,
  -- Stamped when the cycle is closed out (open work rolled forward).
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique nulls not distinct (property_id, space_id, number)
);

create index cycles_property_idx on public.cycles (property_id, space_id, starts_on);

alter table public.cycles enable row level security;
create policy "cycles members"
  on public.cycles for all
  using (public.is_member(property_id))
  with check (public.is_member(property_id));
create trigger cycles_set_updated_at
  before update on public.cycles
  for each row execute function public.set_updated_at();

-- One cadence per (property, team). The app layer (`ensureCycles`) keeps the
-- current cycle + `upcoming_count` future ones materialised and rolls open
-- work forward when a cycle ends — no cron needed.
create table public.cycle_settings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete cascade,
  enabled boolean not null default true,
  duration_weeks integer not null default 1 check (duration_weeks between 1 and 8),
  -- 0 = Sunday … 6 = Saturday (JS getDay()).
  start_weekday integer not null default 1 check (start_weekday between 0 and 6),
  upcoming_count integer not null default 2 check (upcoming_count between 1 and 6),
  auto_rollover boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (property_id, space_id)
);

alter table public.cycle_settings enable row level security;
create policy "cycle_settings members"
  on public.cycle_settings for all
  using (public.is_member(property_id))
  with check (public.is_member(property_id));
create trigger cycle_settings_set_updated_at
  before update on public.cycle_settings
  for each row execute function public.set_updated_at();

alter table public.tasks
  -- Effort points (Linear's Fibonacci scale by convention: 0/1/2/3/5/8/13).
  -- NULL = unestimated; scope math counts an unestimated task as 1.
  add column if not exists estimate smallint check (estimate is null or estimate between 0 and 100),
  add column if not exists cycle_id uuid references public.cycles(id) on delete set null,
  add column if not exists milestone_id uuid references public.project_milestones(id) on delete set null,
  -- Triage queue: 'pending' tasks wait for a human Accept / Decline before
  -- they reach the board. NULL = never triaged (the normal case).
  add column if not exists triage_state text
    check (triage_state is null or triage_state in ('pending', 'accepted', 'declined')),
  add column if not exists triaged_by uuid references auth.users(id) on delete set null,
  add column if not exists triaged_at timestamptz,
  add column if not exists triage_note text check (triage_note is null or char_length(triage_note) <= 1000);

create index if not exists tasks_cycle_idx on public.tasks (cycle_id) where cycle_id is not null;
create index if not exists tasks_milestone_idx on public.tasks (milestone_id) where milestone_id is not null;
create index if not exists tasks_triage_pending_idx
  on public.tasks (property_id, created_at desc) where triage_state = 'pending';

-- ── Initiatives ──────────────────────────────────────────────────────────────

create table public.initiatives (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  icon text,
  color text not null default 'violet'
    check (color in ('slate','blue','green','amber','rose','violet')),
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed')),
  owner_id uuid references auth.users(id) on delete set null,
  lead_space_id uuid references public.spaces(id) on delete set null,
  target_date date,
  position double precision not null default 0,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index initiatives_property_idx on public.initiatives (property_id, status, position);

alter table public.initiatives enable row level security;
create policy "initiatives members"
  on public.initiatives for all
  using (public.is_member(property_id))
  with check (public.is_member(property_id));
create trigger initiatives_set_updated_at
  before update on public.initiatives
  for each row execute function public.set_updated_at();

-- Many-to-many: a project can serve more than one initiative.
create table public.initiative_projects (
  initiative_id uuid not null references public.initiatives(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  primary key (initiative_id, project_id)
);

create index initiative_projects_project_idx on public.initiative_projects (project_id);

alter table public.initiative_projects enable row level security;
create policy "initiative_projects members"
  on public.initiative_projects for all
  using (public.is_member(property_id))
  with check (public.is_member(property_id));

-- ── Status updates (projects + initiatives) ──────────────────────────────────

-- Linear's "Write project update": a person-written health call + note. The
-- latest update's health is the entity's DECLARED health, shown beside the
-- computed pace health.
create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  initiative_id uuid references public.initiatives(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  health text not null check (health in ('on_track', 'at_risk', 'off_track')),
  body text not null default '' check (char_length(body) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((project_id is null) <> (initiative_id is null))
);

create index project_updates_project_idx
  on public.project_updates (project_id, created_at desc) where project_id is not null;
create index project_updates_initiative_idx
  on public.project_updates (initiative_id, created_at desc) where initiative_id is not null;

alter table public.project_updates enable row level security;
create policy "project_updates read"
  on public.project_updates for select
  using (public.is_member(property_id));
create policy "project_updates insert own"
  on public.project_updates for insert
  with check (public.is_member(property_id) and author_id = auth.uid());
create policy "project_updates update own"
  on public.project_updates for update
  using (public.is_member(property_id) and author_id = auth.uid())
  with check (public.is_member(property_id) and author_id = auth.uid());
create policy "project_updates delete own"
  on public.project_updates for delete
  using (public.is_member(property_id) and author_id = auth.uid());
create trigger project_updates_set_updated_at
  before update on public.project_updates
  for each row execute function public.set_updated_at();

-- ── Activity log coverage ────────────────────────────────────────────────────

alter table public.activity_log drop constraint if exists activity_log_entity_kind_check;
alter table public.activity_log add constraint activity_log_entity_kind_check
  check (entity_kind in ('task', 'project', 'milestone', 'initiative', 'cycle'));

-- The planning fields get their own small trigger rather than a rewrite of
-- `tasks_log_activity` (0106) — same one-row-per-changed-field contract.
create or replace function public.tasks_log_planning_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estimate is distinct from new.estimate then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'estimate_changed',
      jsonb_build_object('from', old.estimate, 'to', new.estimate),
      new.project_id, new.space_id);
  end if;
  if old.cycle_id is distinct from new.cycle_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'cycle_changed',
      jsonb_build_object('from', old.cycle_id, 'to', new.cycle_id),
      new.project_id, new.space_id);
  end if;
  if old.milestone_id is distinct from new.milestone_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'milestone_changed',
      jsonb_build_object('from', old.milestone_id, 'to', new.milestone_id),
      new.project_id, new.space_id);
  end if;
  if old.triage_state is distinct from new.triage_state and new.triage_state is not null then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case new.triage_state when 'accepted' then 'triage_accepted'
                            when 'declined' then 'triage_declined'
                            else 'triage_queued' end,
      jsonb_build_object('note', new.triage_note),
      new.project_id, new.space_id);
  end if;
  return new;
end;
$$;

create trigger tasks_log_planning_activity_au
  after update on public.tasks
  for each row execute function public.tasks_log_planning_activity();

create or replace function public.initiatives_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(
      new.property_id, 'initiative', new.id, new.name, 'created',
      jsonb_build_object('status', new.status), null, new.lead_space_id);
    return new;
  end if;
  if old.status is distinct from new.status then
    perform public.log_activity(
      new.property_id, 'initiative', new.id, new.name, 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status), null, new.lead_space_id);
  end if;
  if old.target_date is distinct from new.target_date then
    perform public.log_activity(
      new.property_id, 'initiative', new.id, new.name, 'dates_changed',
      jsonb_build_object('from', old.target_date, 'to', new.target_date), null, new.lead_space_id);
  end if;
  if old.owner_id is distinct from new.owner_id then
    perform public.log_activity(
      new.property_id, 'initiative', new.id, new.name, 'lead_changed',
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id), null, new.lead_space_id);
  end if;
  if old.archived_at is distinct from new.archived_at then
    perform public.log_activity(
      new.property_id, 'initiative', new.id, new.name,
      case when new.archived_at is null then 'unarchived' else 'archived' end,
      '{}'::jsonb, null, new.lead_space_id);
  end if;
  return new;
end;
$$;

create trigger initiatives_log_activity_aiu
  after insert or update on public.initiatives
  for each row execute function public.initiatives_log_activity();

create or replace function public.project_updates_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  title text;
begin
  if new.project_id is not null then
    select name into title from public.projects where id = new.project_id;
    perform public.log_activity(
      new.property_id, 'project', new.project_id, coalesce(title, 'Project'), 'update_posted',
      jsonb_build_object('update_id', new.id, 'health', new.health), new.project_id, null);
  else
    select name into title from public.initiatives where id = new.initiative_id;
    perform public.log_activity(
      new.property_id, 'initiative', new.initiative_id, coalesce(title, 'Initiative'), 'update_posted',
      jsonb_build_object('update_id', new.id, 'health', new.health), null, null);
  end if;
  return new;
end;
$$;

create trigger project_updates_log_activity_ai
  after insert on public.project_updates
  for each row execute function public.project_updates_log_activity();

-- ── Realtime ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.cycles;
alter publication supabase_realtime add table public.initiatives;
alter publication supabase_realtime add table public.initiative_projects;
alter publication supabase_realtime add table public.project_updates;
