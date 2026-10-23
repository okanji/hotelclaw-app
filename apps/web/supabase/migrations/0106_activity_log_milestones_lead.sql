-- 0106: who did what — an actor-aware activity log, project milestones, and a
-- project lead.
--
-- Three gaps a side-by-side with gr8r-studio surfaced:
--
--  1. `workflow_events` is the automation OUTBOX (0026): triggers write it with
--     no acting user, and only for the events workflows can trigger on. So the
--     project/space "Activity" rails could say *what* moved but never *who*
--     moved it, the task page had no field history at all, and nothing could
--     answer "what changed across the property today, and by whom". This adds
--     `activity_log`: one row per human-meaningful change to a task, project
--     or milestone, stamped with `auth.uid()` (or a service-side
--     `app.actor_id` GUC when the eve runtime acts for someone), written by
--     triggers so every write path — UI, server action, bot, workflow — is
--     covered without touching application code. `entity_title` is a
--     snapshot so a row still reads after the task is deleted.
--
--  2. Projects had start/target dates but no named points in between.
--     `project_milestones` are gr8r's "Wireframes signed off · Dev handoff ·
--     Public launch": a name + date (+ done), rendered in the project
--     overview and as a diamond lane on the timeline.
--
--  3. Spaces have a `lead_user_id` (0071); projects did not. Adds
--     `projects.lead_user_id` — the one person accountable for the initiative.

-- ── 1. activity_log ──────────────────────────────────────────────────────────

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Who. Null when a service-role write carried no actor hint.
  actor_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'user'
    check (actor_kind in ('user', 'system', 'workflow', 'ai')),
  -- What was acted on. FK-less on purpose: history must survive the row.
  entity_kind text not null check (entity_kind in ('task', 'project', 'milestone')),
  entity_id uuid not null,
  entity_title text,
  -- How it changed. `detail` carries {from, to} (+ verb-specific extras).
  verb text not null,
  detail jsonb not null default '{}'::jsonb,
  -- Denormalised scope so project/space feeds are one indexed filter.
  project_id uuid references public.projects(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.activity_log is
  'Actor-aware change log for tasks, projects and milestones. Written by triggers; read by the Activity surfaces. Not an automation source — that is workflow_events.';

create index activity_log_property_idx
  on public.activity_log (property_id, created_at desc);
create index activity_log_entity_idx
  on public.activity_log (entity_id, created_at desc);
create index activity_log_project_idx
  on public.activity_log (project_id, created_at desc)
  where project_id is not null;
create index activity_log_space_idx
  on public.activity_log (space_id, created_at desc)
  where space_id is not null;
create index activity_log_actor_idx
  on public.activity_log (actor_id, created_at desc)
  where actor_id is not null;

alter table public.activity_log enable row level security;

create policy "activity_log members read"
  on public.activity_log for select
  using (public.is_member(property_id));
-- No insert/update/delete policies: rows come from the security-definer
-- triggers below (and the service role). Members never write history directly.

alter publication supabase_realtime add table public.activity_log;

-- The actor for the current statement: the signed-in user, else a hint the
-- server set for this transaction (`set local app.actor_id = '<uuid>'`), else
-- null. Service-role writes with no hint are 'system'.
create or replace function public.activity_actor()
returns table (actor_id uuid, actor_kind text)
language plpgsql
stable
as $$
declare
  hinted text := nullif(current_setting('app.actor_id', true), '');
  hinted_kind text := nullif(current_setting('app.actor_kind', true), '');
begin
  actor_id := coalesce(auth.uid(), hinted::uuid);
  actor_kind := case
    when hinted_kind in ('user', 'system', 'workflow', 'ai') then hinted_kind
    when actor_id is not null then 'user'
    else 'system'
  end;
  return next;
end;
$$;

create or replace function public.log_activity(
  p_property_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_entity_title text,
  p_verb text,
  p_detail jsonb,
  p_project_id uuid,
  p_space_id uuid,
  p_actor_kind_override text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  select * into a from public.activity_actor();
  insert into public.activity_log
    (property_id, actor_id, actor_kind, entity_kind, entity_id, entity_title,
     verb, detail, project_id, space_id)
  values
    (p_property_id, a.actor_id,
     coalesce(p_actor_kind_override, a.actor_kind),
     p_entity_kind, p_entity_id, p_entity_title,
     p_verb, coalesce(p_detail, '{}'::jsonb), p_project_id, p_space_id);
end;
$$;

-- ── Tasks ────────────────────────────────────────────────────────────────────

create or replace function public.tasks_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added text[];
  removed text[];
  kind_override text;
begin
  if tg_op = 'INSERT' then
    -- A workflow- or AI-created task is attributed to that engine even when a
    -- session is present (the eve runtime acts under a person's scope).
    kind_override := case new.source when 'workflow' then 'workflow' when 'ai' then 'ai' else null end;
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'created',
      jsonb_build_object('status', new.status, 'priority', new.priority,
                         'assignee_id', new.assignee_id, 'due_at', new.due_at,
                         'parent_id', new.parent_id),
      new.project_id, new.space_id, kind_override);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.log_activity(
      old.property_id, 'task', old.id, old.title, 'deleted',
      jsonb_build_object('status', old.status), old.project_id, old.space_id);
    return old;
  end if;

  -- UPDATE: one row per changed field, so feeds can filter by verb.
  if old.status is distinct from new.status then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case when new.status = 'done' then 'completed'
           when old.status = 'done' then 'reopened'
           else 'status_changed' end,
      jsonb_build_object('from', old.status, 'to', new.status),
      new.project_id, new.space_id);
  end if;
  if old.priority is distinct from new.priority then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'priority_changed',
      jsonb_build_object('from', old.priority, 'to', new.priority),
      new.project_id, new.space_id);
  end if;
  if old.assignee_id is distinct from new.assignee_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case when new.assignee_id is null then 'unassigned' else 'assigned' end,
      jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id),
      new.project_id, new.space_id);
  end if;
  if old.due_at is distinct from new.due_at then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'due_changed',
      jsonb_build_object('from', old.due_at, 'to', new.due_at),
      new.project_id, new.space_id);
  end if;
  if old.scheduled_start is distinct from new.scheduled_start
     or old.scheduled_end is distinct from new.scheduled_end then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'scheduled',
      jsonb_build_object('from_start', old.scheduled_start, 'from_end', old.scheduled_end,
                         'to_start', new.scheduled_start, 'to_end', new.scheduled_end),
      new.project_id, new.space_id);
  end if;
  if old.title is distinct from new.title then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'renamed',
      jsonb_build_object('from', old.title, 'to', new.title),
      new.project_id, new.space_id);
  end if;
  if old.description is distinct from new.description then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'description_changed',
      '{}'::jsonb, new.project_id, new.space_id);
  end if;
  if old.labels is distinct from new.labels then
    select array_agg(l) into added
      from unnest(coalesce(new.labels, '{}')) l where l <> all (coalesce(old.labels, '{}'));
    select array_agg(l) into removed
      from unnest(coalesce(old.labels, '{}')) l where l <> all (coalesce(new.labels, '{}'));
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'labels_changed',
      jsonb_build_object('added', coalesce(to_jsonb(added), '[]'::jsonb),
                         'removed', coalesce(to_jsonb(removed), '[]'::jsonb)),
      new.project_id, new.space_id);
  end if;
  if old.project_id is distinct from new.project_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'project_changed',
      jsonb_build_object('from', old.project_id, 'to', new.project_id),
      new.project_id, new.space_id);
    -- The project it LEFT should also see the departure in its feed.
    if old.project_id is not null then
      perform public.log_activity(
        new.property_id, 'task', new.id, new.title, 'project_removed',
        jsonb_build_object('from', old.project_id, 'to', new.project_id),
        old.project_id, new.space_id);
    end if;
  end if;
  if old.space_id is distinct from new.space_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'space_changed',
      jsonb_build_object('from', old.space_id, 'to', new.space_id),
      new.project_id, new.space_id);
  end if;
  if old.parent_id is distinct from new.parent_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'parent_changed',
      jsonb_build_object('from', old.parent_id, 'to', new.parent_id),
      new.project_id, new.space_id);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_log_activity_aiud on public.tasks;
create trigger tasks_log_activity_aiud
  after insert or update or delete on public.tasks
  for each row execute function public.tasks_log_activity();

-- ── Projects (+ lead) ────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists lead_user_id uuid references auth.users(id) on delete set null;

create or replace function public.projects_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'created',
      jsonb_build_object('status', new.status), new.id, null);
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.log_activity(
      old.property_id, 'project', old.id, old.name, 'deleted', '{}'::jsonb, null, null);
    return old;
  end if;
  if old.status is distinct from new.status then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'status_changed',
      jsonb_build_object('from', old.status, 'to', new.status), new.id, null);
  end if;
  if old.name is distinct from new.name then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'renamed',
      jsonb_build_object('from', old.name, 'to', new.name), new.id, null);
  end if;
  if old.description is distinct from new.description then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'description_changed',
      '{}'::jsonb, new.id, null);
  end if;
  if old.start_date is distinct from new.start_date
     or old.target_date is distinct from new.target_date then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'dates_changed',
      jsonb_build_object('from_start', old.start_date, 'from_target', old.target_date,
                         'to_start', new.start_date, 'to_target', new.target_date),
      new.id, null);
  end if;
  if old.lead_user_id is distinct from new.lead_user_id then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name, 'lead_changed',
      jsonb_build_object('from', old.lead_user_id, 'to', new.lead_user_id), new.id, null);
  end if;
  if old.archived_at is distinct from new.archived_at then
    perform public.log_activity(
      new.property_id, 'project', new.id, new.name,
      case when new.archived_at is null then 'restored' else 'archived' end,
      '{}'::jsonb, new.id, null);
  end if;
  return new;
end;
$$;

drop trigger if exists projects_log_activity_aiud on public.projects;
create trigger projects_log_activity_aiud
  after insert or update or delete on public.projects
  for each row execute function public.projects_log_activity();

-- ── 2. project_milestones ────────────────────────────────────────────────────

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  due_date date not null,
  completed_at timestamptz,
  position double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_milestones_project_idx
  on public.project_milestones (project_id, due_date);
create index project_milestones_property_idx
  on public.project_milestones (property_id, due_date);

alter table public.project_milestones enable row level security;

create policy "project_milestones members"
  on public.project_milestones for all
  using (public.is_member(property_id))
  with check (public.is_member(property_id));

create trigger project_milestones_set_updated_at
  before update on public.project_milestones
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.project_milestones;

create or replace function public.project_milestones_log_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(
      new.property_id, 'milestone', new.id, new.name, 'milestone_added',
      jsonb_build_object('due_date', new.due_date), new.project_id, null);
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.log_activity(
      old.property_id, 'milestone', old.id, old.name, 'milestone_removed',
      jsonb_build_object('due_date', old.due_date), old.project_id, null);
    return old;
  end if;
  if old.completed_at is distinct from new.completed_at then
    perform public.log_activity(
      new.property_id, 'milestone', new.id, new.name,
      case when new.completed_at is null then 'milestone_reopened' else 'milestone_completed' end,
      jsonb_build_object('due_date', new.due_date), new.project_id, null);
  end if;
  if old.name is distinct from new.name or old.due_date is distinct from new.due_date then
    perform public.log_activity(
      new.property_id, 'milestone', new.id, new.name, 'milestone_changed',
      jsonb_build_object('from_name', old.name, 'to_name', new.name,
                         'from_due', old.due_date, 'to_due', new.due_date),
      new.project_id, null);
  end if;
  return new;
end;
$$;

create trigger project_milestones_log_activity_aiud
  after insert or update or delete on public.project_milestones
  for each row execute function public.project_milestones_log_activity();
