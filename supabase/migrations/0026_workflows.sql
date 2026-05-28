-- AI-powered workflow / automation system.
--
-- Three concerns in one migration:
--   1. Workflow tables: workflows, workflow_versions, workflow_runs, workflow_step_runs,
--      workflow_events (outbox), workflow_schedules, workflow_templates, workflow_suggestions.
--   2. Workflow-defined entities: entity_types + entities (schema-less rows validated in app code
--      against the type's JSON Schema). First-class triggers fire on entity changes.
--   3. Postgres triggers that emit into workflow_events on data changes (tasks, entities).
--      Stream/Liveblocks/Calendar webhook handlers emit the same shape via lib/workflows/event-emitter.ts.

-- ============================================================================
-- entity_types — workflow-defined entity declarations (rooms, guests, bookings, …).
-- ============================================================================

create table public.entity_types (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,                    -- machine name, e.g. 'room'
  display_name text not null,            -- 'Room', 'Guest', etc.
  schema jsonb not null default '{}'::jsonb,  -- JSON Schema for `entities.data`
  display_config jsonb not null default '{}'::jsonb,  -- { primaryField, color, icon, … }
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

create index entity_types_property_id_idx on public.entity_types (property_id);

-- ============================================================================
-- entities — rows of any workflow-defined type.
-- ============================================================================

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  entity_type_id uuid not null references public.entity_types(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index entities_property_type_idx on public.entities (property_id, entity_type_id);
create index entities_data_gin on public.entities using gin (data);

-- ============================================================================
-- workflow_events — outbox of every event candidate.
-- The dispatcher reads from here; webhook handlers + Postgres triggers write here.
-- ============================================================================

create table public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null,           -- 'pg.tasks' | 'pg.entities' | 'stream.message' | 'liveblocks' | 'calendar.google' | 'cron' | 'manual'
  event_type text not null,       -- 'task.created' | 'entity.field_changed' | 'chat.message_posted' | ...
  entity_id uuid,                 -- nullable; FK-less to keep cross-table reference simple
  entity_kind text,               -- 'task' | 'entity' | 'message' | 'document' | …
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  dispatched_at timestamptz,
  matched_workflow_ids uuid[] not null default array[]::uuid[],
  filtered_reason jsonb not null default '{}'::jsonb  -- { "<workflow_id>": "disabled" | "predicate_false" | "rate_limited" | "duplicate" }
);

create index workflow_events_property_received_idx
  on public.workflow_events (property_id, received_at desc);
create index workflow_events_undispatched_idx
  on public.workflow_events (received_at)
  where dispatched_at is null;
create index workflow_events_event_type_idx
  on public.workflow_events (event_type);

-- ============================================================================
-- workflows — one row per logical automation. Latest pointer + lifecycle metadata only.
-- ============================================================================

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  enabled boolean not null default false,        -- start disabled; user explicitly turns on
  mode text not null default 'instant' check (mode in ('instant', 'durable')),
  current_version_id uuid,                       -- FK added below (deferred so we can chicken-and-egg)
  folder_id uuid,                                -- nullable; future folders feature
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_run_status text,
  archived_at timestamptz
);

create index workflows_property_idx on public.workflows (property_id) where archived_at is null;

-- ============================================================================
-- workflow_versions — immutable history of specs. Edits create a new version.
-- ============================================================================

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version int not null,
  spec jsonb not null,
  spec_hash text not null,            -- sha256 of canonical spec (dedupe on save)
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);

-- GIN index on trigger event_type so the dispatcher can answer
-- "which active workflows want event X" in one query.
create index workflow_versions_trigger_event_idx
  on public.workflow_versions ((spec -> 'trigger' ->> 'event_type'));

-- Deferred FK from workflows -> workflow_versions (chicken-and-egg).
alter table public.workflows
  add constraint workflows_current_version_fk
  foreign key (current_version_id) references public.workflow_versions(id)
  on delete set null deferrable initially deferred;

-- ============================================================================
-- workflow_runs — one row per execution.
-- ============================================================================

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  workflow_version_id uuid references public.workflow_versions(id) on delete set null,
  property_id uuid not null references public.properties(id) on delete cascade,
  trigger_event_id uuid references public.workflow_events(id) on delete set null,
  trigger_kind text,
  status text not null check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled', 'filtered')),
  mode text not null check (mode in ('instant', 'durable')),
  durable_run_id text,                -- Vercel Workflow SDK run id when mode='durable'
  triggered_by_user_id uuid references auth.users(id) on delete set null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  error_step_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workflow_id, trigger_event_id)   -- idempotency: one run per (workflow, event)
);

create index workflow_runs_workflow_started_idx
  on public.workflow_runs (workflow_id, started_at desc);
create index workflow_runs_property_started_idx
  on public.workflow_runs (property_id, started_at desc);
create index workflow_runs_active_idx
  on public.workflow_runs (status)
  where status in ('queued', 'running', 'waiting');

-- ============================================================================
-- workflow_step_runs — append-only per-step transcripts.
-- ============================================================================

create table public.workflow_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  step_id text not null,              -- matches spec node id
  step_type text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempt int not null default 1,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error jsonb,
  ai_trace jsonb,                     -- { model, persona, tool_calls, tool_results, token_counts }
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index workflow_step_runs_run_started_idx
  on public.workflow_step_runs (run_id, started_at);

-- ============================================================================
-- workflow_schedules — pg_cron-driven cron triggers.
-- ============================================================================

create table public.workflow_schedules (
  workflow_id uuid primary key references public.workflows(id) on delete cascade,
  cron_expression text not null,
  timezone text not null default 'UTC',
  next_run_at timestamptz,
  pg_cron_jobid bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- workflow_templates — seeded library; user-fork creates a new workflow.
-- Global (not property-scoped); RLS allows read for any authenticated user.
-- ============================================================================

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  category text not null,             -- 'tasks' | 'guests' | 'maintenance' | 'comms' | 'reports'
  surfaces text[] not null default '{}',
  spec jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- workflow_suggestions — proposals from the Tier 2 suggestion engine.
-- ============================================================================

create table public.workflow_suggestions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  proposed_spec jsonb not null,
  pattern_summary text not null,
  est_savings text,                   -- free text like "~12 min/day"
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  applied_workflow_id uuid references public.workflows(id) on delete set null,
  created_at timestamptz not null default now()
);

create index workflow_suggestions_property_idx
  on public.workflow_suggestions (property_id, created_at desc)
  where dismissed_at is null and applied_workflow_id is null;

-- ============================================================================
-- Postgres triggers: emit workflow_events on data changes.
-- ============================================================================

create or replace function public.emit_workflow_event(
  p_property_id uuid,
  p_source text,
  p_event_type text,
  p_entity_id uuid,
  p_entity_kind text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.workflow_events
    (property_id, source, event_type, entity_id, entity_kind, payload)
  values
    (p_property_id, p_source, p_event_type, p_entity_id, p_entity_kind, p_payload);
$$;

-- Task triggers: created, status_changed, assigned, label_added, overdue is handled by pg_cron.
create or replace function public.tasks_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added_labels text[];
begin
  if (tg_op = 'INSERT') then
    perform public.emit_workflow_event(
      new.property_id, 'pg.tasks', 'task.created', new.id, 'task',
      jsonb_build_object('new', to_jsonb(new))
    );
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if old.status is distinct from new.status then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.status_changed', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.status, 'to', new.status)
      );
    end if;
    if old.assignee_id is distinct from new.assignee_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.assigned', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.assignee_id, 'to', new.assignee_id)
      );
    end if;
    -- label_added: emit one event per newly-added label
    select array_agg(l) into added_labels
    from unnest(coalesce(new.labels, '{}')) l
    where l <> all (coalesce(old.labels, '{}'));
    if added_labels is not null then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.label_added', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'added_labels', to_jsonb(added_labels))
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

create trigger tasks_workflow_events_aiu
  after insert or update on public.tasks
  for each row execute function public.tasks_emit_workflow_events();

-- Entity triggers: created, field_changed.
create or replace function public.entities_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  type_name text;
begin
  select et.name into type_name
  from public.entity_types et
  where et.id = coalesce(new.entity_type_id, old.entity_type_id);

  if (tg_op = 'INSERT') then
    perform public.emit_workflow_event(
      new.property_id, 'pg.entities', 'entity.created', new.id, 'entity',
      jsonb_build_object('new', to_jsonb(new), 'type', type_name)
    );
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if old.data is distinct from new.data then
      perform public.emit_workflow_event(
        new.property_id, 'pg.entities', 'entity.field_changed', new.id, 'entity',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new), 'type', type_name)
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

create trigger entities_workflow_events_aiu
  after insert or update on public.entities
  for each row execute function public.entities_emit_workflow_events();

-- updated_at maintenance for entities + entity_types.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger entities_touch_updated_at
  before update on public.entities
  for each row execute function public.touch_updated_at();

create trigger entity_types_touch_updated_at
  before update on public.entity_types
  for each row execute function public.touch_updated_at();

create trigger workflows_touch_updated_at
  before update on public.workflows
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS — scoped through property membership.
-- ============================================================================

alter table public.entity_types enable row level security;
alter table public.entities enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_events enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_step_runs enable row level security;
alter table public.workflow_schedules enable row level security;
alter table public.workflow_templates enable row level security;
alter table public.workflow_suggestions enable row level security;

create policy "entity_types_member" on public.entity_types
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "entities_member" on public.entities
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "workflows_member" on public.workflows
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "workflow_versions_member" on public.workflow_versions
  for all using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_id and public.is_member(w.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_id and public.is_member(w.property_id)
    )
  );

create policy "workflow_events_select_member" on public.workflow_events
  for select using (public.is_member(property_id));

create policy "workflow_runs_member" on public.workflow_runs
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create policy "workflow_step_runs_member" on public.workflow_step_runs
  for select using (
    exists (
      select 1 from public.workflow_runs r
      where r.id = run_id and public.is_member(r.property_id)
    )
  );

create policy "workflow_schedules_member" on public.workflow_schedules
  for all using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_id and public.is_member(w.property_id)
    )
  )
  with check (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_id and public.is_member(w.property_id)
    )
  );

-- Templates: any authenticated user can read.
create policy "workflow_templates_select_auth" on public.workflow_templates
  for select using (auth.uid() is not null);

create policy "workflow_suggestions_member" on public.workflow_suggestions
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

-- ============================================================================
-- Realtime publication — so the run inspector can live-tail.
-- ============================================================================

alter publication supabase_realtime add table public.workflow_runs;
alter publication supabase_realtime add table public.workflow_step_runs;
alter publication supabase_realtime add table public.workflow_events;
