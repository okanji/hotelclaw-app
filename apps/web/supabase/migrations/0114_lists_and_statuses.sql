-- ============================================================================
-- Lists + custom status pipelines (ClickUp parity, phase 1).
--
-- Hierarchy becomes Space (nestable) → List → Task. A list owns a status
-- PIPELINE: a shareable `status_sets` row with ordered `statuses` rows, each
-- carrying a ClickUp category (open | unstarted | active | done | closed)
-- plus an `is_blocked` flag on active rows so "Blocked" keeps a home.
--
-- STRANGLER CONTRACT (read before touching tasks.status anywhere):
--   * `tasks.status_id` is the truth. `tasks.list_id` is required.
--   * `tasks.status` (the 0001 CHECK `todo|in_progress|blocked|done`) is KEPT
--     as a trigger-derived CATEGORY PROJECTION — every legacy reader (~93
--     files, the partial indexes, insights' event reconstruction, saved
--     workflow filters on `trigger.to = 'done'`, mobile) stays correct.
--   * A legacy WRITE of `status` (mobile PATCH, `status:'todo'` inserts in
--     runners/AI tools/seeds) is resolved to a real status row by
--     `tasks_resolve_container_and_status()`; a write of `status_id` wins
--     when both change. Nothing has to be touched to stay correct.
--   * `tasks.completed_at` is stamped on entering done|closed and cleared on
--     leaving — the "is done" predicate for DB-side queries. It replaces the
--     workflow_events reconstruction hack in lib/insights/metrics.ts.
--
-- Board semantics: a single-list scope shows that list's statuses; multi-list
-- scopes show the four category columns (= the old COLUMNS), and a drop there
-- lands on the FIRST status of that category in the task's list.
-- ============================================================================

-- ── 1. Status sets + statuses ───────────────────────────────────────────────

create table public.status_sets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- The property's fallback set (every space/list without its own).
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index status_sets_default_key
  on public.status_sets (property_id) where is_default;
create index status_sets_property_idx
  on public.status_sets (property_id, archived_at);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  status_set_id uuid not null references public.status_sets(id) on delete cascade,
  -- denormalised for RLS (no join)
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  category text not null
    check (category in ('open', 'unstarted', 'active', 'done', 'closed')),
  -- Only meaningful on 'active' — projects to the legacy 'blocked' literal.
  is_blocked boolean not null default false,
  color text not null default 'slate'
    check (color in ('slate', 'blue', 'green', 'amber', 'rose', 'violet')),
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (not is_blocked or category = 'active')
);
-- ClickUp invariant: at most one open + one closed per set (presence is
-- enforced by the app + the seed; the delete guard below keeps the last one).
create unique index statuses_one_open_per_set
  on public.statuses (status_set_id) where category = 'open' and archived_at is null;
create unique index statuses_one_closed_per_set
  on public.statuses (status_set_id) where category = 'closed' and archived_at is null;
create unique index statuses_name_per_set
  on public.statuses (status_set_id, lower(name)) where archived_at is null;
create index statuses_set_idx on public.statuses (status_set_id, position);
create index statuses_property_idx on public.statuses (property_id);

-- ── 2. Lists ────────────────────────────────────────────────────────────────

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- NULL = property-level list (the "General" catch-all, or any list a
  -- property keeps outside its teams).
  space_id uuid references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  icon text,
  color text not null default 'slate'
    check (color in ('slate', 'blue', 'green', 'amber', 'rose', 'violet')),
  position double precision not null default 0,
  -- The EFFECTIVE set. `inherits_statuses` says whether it follows the
  -- space's/property's default (pointer kept in sync) or is pinned/forked.
  status_set_id uuid not null references public.status_sets(id) on delete restrict,
  inherits_statuses boolean not null default true,
  -- The catch-all list of its space (or of the property when space_id is
  -- null). Tasks with no list resolve here.
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index lists_default_per_space
  on public.lists (space_id) where is_default and space_id is not null;
create unique index lists_default_per_property
  on public.lists (property_id) where is_default and space_id is null;
create index lists_space_idx on public.lists (property_id, space_id, position);
create index lists_status_set_idx on public.lists (status_set_id);

alter table public.spaces
  add column if not exists default_status_set_id uuid
    references public.status_sets(id) on delete set null;

-- ── 3. Tasks + custom_fields columns ────────────────────────────────────────

alter table public.tasks
  add column if not exists list_id uuid references public.lists(id) on delete restrict,
  add column if not exists status_id uuid references public.statuses(id) on delete restrict,
  add column if not exists completed_at timestamptz;
-- NOT NULL on list_id / status_id is set after the backfill (section 9).

create index tasks_list_status_position_idx
  on public.tasks (list_id, status_id, position) where archived_at is null;
create index tasks_completed_idx
  on public.tasks (property_id, completed_at) where completed_at is not null;
create index tasks_status_id_idx on public.tasks (status_id);

-- Field scope widens: null+null = property, space = team, list = that list.
alter table public.custom_fields
  add column if not exists list_id uuid references public.lists(id) on delete cascade;
create index custom_fields_list_idx on public.custom_fields (list_id) where list_id is not null;

-- ── 4. RLS + realtime + updated_at ──────────────────────────────────────────

alter table public.status_sets enable row level security;
alter table public.statuses enable row level security;
alter table public.lists enable row level security;

-- Read + create: any member. Editing a PIPELINE (rename / reorder / recolor /
-- delete statuses, re-point a set) is owner/manager — same shape as 0109's
-- shared-view policy. Lists themselves are ordinary team data.
create policy "status_sets select member" on public.status_sets
  for select using (public.is_member(property_id));
create policy "status_sets insert member" on public.status_sets
  for insert with check (public.is_member(property_id));
create policy "status_sets update management" on public.status_sets
  for update using (
    exists (select 1 from public.memberships m
            where m.property_id = status_sets.property_id
              and m.user_id = auth.uid() and m.role in ('owner', 'manager')));
create policy "status_sets delete management" on public.status_sets
  for delete using (
    exists (select 1 from public.memberships m
            where m.property_id = status_sets.property_id
              and m.user_id = auth.uid() and m.role in ('owner', 'manager')));

create policy "statuses select member" on public.statuses
  for select using (public.is_member(property_id));
create policy "statuses insert member" on public.statuses
  for insert with check (public.is_member(property_id));
create policy "statuses update management" on public.statuses
  for update using (
    exists (select 1 from public.memberships m
            where m.property_id = statuses.property_id
              and m.user_id = auth.uid() and m.role in ('owner', 'manager')));
create policy "statuses delete management" on public.statuses
  for delete using (
    exists (select 1 from public.memberships m
            where m.property_id = statuses.property_id
              and m.user_id = auth.uid() and m.role in ('owner', 'manager')));

create policy "lists members" on public.lists
  for all using (public.is_member(property_id))
  with check (public.is_member(property_id));

create trigger status_sets_set_updated_at
  before update on public.status_sets
  for each row execute function public.set_updated_at();
create trigger statuses_set_updated_at
  before update on public.statuses
  for each row execute function public.set_updated_at();
create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.status_sets;
alter publication supabase_realtime add table public.statuses;
alter publication supabase_realtime add table public.lists;

-- ── 5. Resolution helpers (security definer: triggers + backfill call them) ─

-- First status of a set matching (category, blocked), by position.
create or replace function public.status_for_category(
  p_set uuid, p_category text, p_blocked boolean default false
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.statuses
  where status_set_id = p_set and archived_at is null
    and category = p_category and is_blocked = p_blocked
  order by position, created_at
  limit 1
$$;

-- The 0001 literal → a status row of the set. Mirrors lib/tasks/statuses.ts
-- `statusForLegacy` — keep the two in step (a unit test parses this body).
create or replace function public.resolve_legacy_status(p_set uuid, p_legacy text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case p_legacy
      when 'todo'        then public.status_for_category(p_set, 'open')
      when 'in_progress' then public.status_for_category(p_set, 'active', false)
      when 'blocked'     then coalesce(public.status_for_category(p_set, 'active', true),
                                       public.status_for_category(p_set, 'active', false))
      when 'done'        then coalesce(public.status_for_category(p_set, 'closed'),
                                       public.status_for_category(p_set, 'done'))
    end,
    public.status_for_category(p_set, 'open')
  )
$$;

-- category + blocked → the legacy literal. THE projection; lib/tasks/statuses.ts
-- `legacyOf` mirrors it.
create or replace function public.legacy_status_of(p_category text, p_blocked boolean)
returns text
language sql
immutable
as $$
  select case p_category
    when 'open'      then 'todo'
    when 'unstarted' then 'todo'
    when 'active'    then case when p_blocked then 'blocked' else 'in_progress' end
    when 'done'      then 'done'
    when 'closed'    then 'done'
  end
$$;

-- A space's effective default set: its own, else the nearest ancestor's,
-- else the property default. Depth-limited like org actions' cycle guard.
create or replace function public.space_status_set(p_space uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cur uuid := p_space;
  found uuid;
  prop uuid;
  depth int := 0;
begin
  while cur is not null and depth < 32 loop
    select default_status_set_id, parent_space_id, property_id
      into found, cur, prop
      from public.spaces where id = cur;
    if found is not null then return found; end if;
    depth := depth + 1;
  end loop;
  if prop is null then
    select property_id into prop from public.spaces where id = p_space;
  end if;
  select id into found from public.status_sets
    where property_id = prop and is_default limit 1;
  return found;
end;
$$;

-- Idempotent: the property's default set (+ 4 seed statuses) and its
-- property-level "General" default list. Returns the set id.
create or replace function public.ensure_property_status_defaults(p_property uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  set_id uuid;
begin
  select id into set_id from public.status_sets
    where property_id = p_property and is_default limit 1;
  if set_id is null then
    insert into public.status_sets (property_id, name, is_default)
      values (p_property, 'Default', true)
      returning id into set_id;
    insert into public.statuses (status_set_id, property_id, name, category, is_blocked, color, position) values
      (set_id, p_property, 'To do',       'open',   false, 'slate', 1024),
      (set_id, p_property, 'In progress', 'active', false, 'blue',  2048),
      (set_id, p_property, 'Blocked',     'active', true,  'amber', 3072),
      (set_id, p_property, 'Done',        'closed', false, 'green', 4096);
  end if;
  if not exists (select 1 from public.lists
                 where property_id = p_property and space_id is null and is_default) then
    insert into public.lists (property_id, space_id, name, status_set_id, inherits_statuses, is_default, position)
      values (p_property, null, 'General', set_id, true, true, 0);
  end if;
  return set_id;
end;
$$;

-- Idempotent: a space's default "Tasks" list. Archived alongside the space.
create or replace function public.ensure_space_default_list(p_space uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  list_id uuid;
begin
  select id, property_id, archived_at into s from public.spaces where id = p_space;
  if s.id is null then return null; end if;
  select id into list_id from public.lists
    where space_id = p_space and is_default limit 1;
  if list_id is null then
    perform public.ensure_property_status_defaults(s.property_id);
    insert into public.lists (property_id, space_id, name, status_set_id, inherits_statuses, is_default, position, archived_at)
      values (s.property_id, p_space, 'Tasks', public.space_status_set(p_space), true, true, 0, s.archived_at)
      returning id into list_id;
  end if;
  return list_id;
end;
$$;

-- The list a task falls into when none is given: space default, else General.
create or replace function public.default_list_for(p_property uuid, p_space uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select id from public.lists where space_id = p_space and is_default limit 1),
    (select id from public.lists where property_id = p_property and space_id is null and is_default limit 1)
  )
$$;

-- ── 6. The resolver: BEFORE INSERT OR UPDATE on tasks ───────────────────────
-- Named so it sorts FIRST among the tasks_* BEFORE triggers (they fire
-- alphabetically): the overdue/due-reminder resets below read the
-- completed_at this one stamps.

create or replace function public.tasks_resolve_container_and_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  list_rec record;
  st record;
  set_id uuid;
begin
  -- 1. List resolution
  if new.list_id is null then
    if new.parent_id is not null then
      select list_id into new.list_id from public.tasks where id = new.parent_id;
    end if;
    if new.list_id is null then
      new.list_id := public.default_list_for(new.property_id, new.space_id);
    end if;
    if new.list_id is null then
      -- A property older than this migration with no defaults yet.
      perform public.ensure_property_status_defaults(new.property_id);
      new.list_id := public.default_list_for(new.property_id, new.space_id);
    end if;
  end if;

  -- 2. Space ↔ list sync
  if tg_op = 'UPDATE' and old.list_id is distinct from new.list_id then
    select space_id into list_rec from public.lists where id = new.list_id;
    if list_rec.space_id is not null then
      new.space_id := list_rec.space_id;
    end if;
  elsif tg_op = 'UPDATE' and old.space_id is distinct from new.space_id then
    select space_id into list_rec from public.lists where id = new.list_id;
    if list_rec.space_id is distinct from new.space_id and list_rec.space_id is not null then
      new.list_id := public.default_list_for(new.property_id, new.space_id);
    end if;
  elsif tg_op = 'INSERT' then
    -- A space-bound list defines the team; a property-level list keeps
    -- whatever team the caller passed.
    select space_id into list_rec from public.lists where id = new.list_id;
    if list_rec.space_id is not null then
      new.space_id := list_rec.space_id;
    end if;
  end if;

  select status_set_id into set_id from public.lists where id = new.list_id;
  if set_id is null then
    raise exception 'tasks.list_id % has no status set', new.list_id;
  end if;

  -- 3. Status resolution (status_id wins over the legacy literal)
  if tg_op = 'INSERT' then
    if new.status_id is null then
      new.status_id := public.resolve_legacy_status(set_id, coalesce(new.status, 'todo'));
    end if;
  else
    if old.status_id is distinct from new.status_id and new.status_id is not null then
      null; -- explicit; validated below
    elsif old.status is distinct from new.status then
      new.status_id := public.resolve_legacy_status(set_id, new.status);
    elsif new.status_id is null then
      new.status_id := public.resolve_legacy_status(set_id, coalesce(new.status, 'todo'));
    end if;
  end if;

  -- The chosen status must belong to the list's set; otherwise remap by
  -- category + blocked flag (list moves, stale ids), falling back to open.
  select id, status_set_id, category, is_blocked into st
    from public.statuses where id = new.status_id;
  if st.id is null then
    new.status_id := public.status_for_category(set_id, 'open');
    select id, status_set_id, category, is_blocked into st
      from public.statuses where id = new.status_id;
  elsif st.status_set_id <> set_id then
    new.status_id := coalesce(
      public.status_for_category(set_id, st.category, st.is_blocked),
      case when st.category = 'active' and st.is_blocked
           then public.status_for_category(set_id, 'active', false) end,
      case when st.category = 'done'
           then public.status_for_category(set_id, 'closed') end,
      case when st.category = 'closed'
           then public.status_for_category(set_id, 'done') end,
      case when st.category = 'unstarted'
           then public.status_for_category(set_id, 'open') end,
      public.status_for_category(set_id, 'open'));
    select id, status_set_id, category, is_blocked into st
      from public.statuses where id = new.status_id;
  end if;

  -- 4. Projection — keeps the 0001 CHECK + every legacy reader honest.
  new.status := public.legacy_status_of(st.category, st.is_blocked);

  -- 5. completed_at
  if st.category in ('done', 'closed') then
    if new.completed_at is null then new.completed_at := now(); end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_a_resolve_container_status_biu on public.tasks;
create trigger tasks_a_resolve_container_status_biu
  before insert or update on public.tasks
  for each row execute function public.tasks_resolve_container_and_status();

-- ── 7. Rewritten task triggers (full bodies restated — see plan G6) ─────────

-- 0040 workflow events: status by status_id; richer payload; list move event.
create or replace function public.tasks_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  added_labels text[];
  from_st record;
  to_st record;
begin
  if (tg_op = 'INSERT') then
    perform public.emit_workflow_event(
      new.property_id, 'pg.tasks', 'task.created', new.id, 'task',
      jsonb_build_object('new', to_jsonb(new))
    );
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    if old.status_id is distinct from new.status_id then
      select name, category, is_blocked into from_st from public.statuses where id = old.status_id;
      select name, category, is_blocked into to_st from public.statuses where id = new.status_id;
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.status_changed', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           -- legacy literals: saved workflow filters match on these
                           'from', old.status, 'to', new.status,
                           'from_status_id', old.status_id, 'to_status_id', new.status_id,
                           'from_name', from_st.name, 'to_name', to_st.name,
                           'from_category', from_st.category, 'to_category', to_st.category,
                           'to_blocked', coalesce(to_st.is_blocked, false))
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
    if old.space_id is distinct from new.space_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.added_to_space', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.space_id, 'to', new.space_id)
      );
    end if;
    if old.project_id is distinct from new.project_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.added_to_project', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.project_id, 'to', new.project_id)
      );
    end if;
    if old.list_id is distinct from new.list_id then
      perform public.emit_workflow_event(
        new.property_id, 'pg.tasks', 'task.moved_to_list', new.id, 'task',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new),
                           'from', old.list_id, 'to', new.list_id)
      );
    end if;
    return new;
  end if;

  return null;
end;
$$;

-- 0106 activity log: completed/reopened keyed on completed_at; list_changed.
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
  from_st record;
  to_st record;
begin
  if tg_op = 'INSERT' then
    kind_override := case new.source when 'workflow' then 'workflow' when 'ai' then 'ai' else null end;
    select name into to_st from public.statuses where id = new.status_id;
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'created',
      jsonb_build_object('status', new.status, 'status_name', to_st.name,
                         'priority', new.priority,
                         'assignee_id', new.assignee_id, 'due_at', new.due_at,
                         'parent_id', new.parent_id, 'list_id', new.list_id),
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
  if old.status_id is distinct from new.status_id then
    select name, category into from_st from public.statuses where id = old.status_id;
    select name, category into to_st from public.statuses where id = new.status_id;
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title,
      case when old.completed_at is null and new.completed_at is not null then 'completed'
           when old.completed_at is not null and new.completed_at is null then 'reopened'
           else 'status_changed' end,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'from_name', from_st.name, 'to_name', to_st.name,
                         'from_category', from_st.category, 'to_category', to_st.category),
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
  if old.list_id is distinct from new.list_id then
    perform public.log_activity(
      new.property_id, 'task', new.id, new.title, 'list_changed',
      jsonb_build_object('from', old.list_id, 'to', new.list_id),
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

-- 0028 overdue reset: keyed on completed_at; must also fire for status_id-only
-- writes (an `update of status` column list never would).
create or replace function public.tasks_reset_overdue_on_reopen()
returns trigger
language plpgsql
as $$
begin
  if old.completed_at is not null and new.completed_at is null then
    new.overdue_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_reset_overdue_bu on public.tasks;
create trigger tasks_reset_overdue_bu
  before update of status, status_id, completed_at on public.tasks
  for each row execute function public.tasks_reset_overdue_on_reopen();

-- Partial indexes: `status <> 'done'` ≡ `completed_at is null` after the
-- backfill; swapping lets the legacy column retire someday.
drop index if exists public.tasks_overdue_candidates_idx;
create index tasks_overdue_candidates_idx
  on public.tasks (property_id, due_at)
  where completed_at is null and overdue_notified_at is null and due_at is not null;

drop index if exists public.tasks_due_reminder_candidates_idx;
create index tasks_due_reminder_candidates_idx
  on public.tasks (due_at)
  where due_reminder_sent_at is null
    and due_at is not null
    and assignee_id is not null
    and completed_at is null
    and archived_at is null;

-- 0090 keyword search: return type changes → drop first. Additive columns.
drop function if exists public.search_tasks_keyword(uuid, text, boolean, int);
create function public.search_tasks_keyword(
  property_id_param uuid,
  query_text        text,
  include_done      boolean default true,
  match_count       int default 20
)
returns table (
  id              uuid,
  title           text,
  status          text,
  priority        text,
  due_at          timestamptz,
  assignee_id     uuid,
  preview         text,
  updated_at      timestamptz,
  rank            real,
  status_name     text,
  status_category text,
  list_id         uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as tsq
  )
  select
    t.id,
    t.title,
    t.status,
    t.priority,
    t.due_at,
    t.assignee_id,
    left(coalesce(t.description, ''), 240) as preview,
    t.updated_at,
    ts_rank_cd(t.search_fts, q.tsq)        as rank,
    s.name                                  as status_name,
    s.category                              as status_category,
    t.list_id
  from public.tasks t
  cross join q
  left join public.statuses s on s.id = t.status_id
  where t.property_id = property_id_param
    and q.tsq         <> ''::tsquery
    and t.search_fts  @@ q.tsq
    and (include_done or t.completed_at is null)
  order by rank desc, t.updated_at desc
  limit greatest(1, least(coalesce(match_count, 20), 50));
$$;

comment on function public.search_tasks_keyword(uuid, text, boolean, int) is
  'Keyword search over title + description for a property''s tasks (done
   included by default). property_id_param is the tenancy gate on
   service-role calls; RLS covers the invoker path.';

grant execute on function public.search_tasks_keyword(uuid, text, boolean, int)
  to authenticated;

-- ── 8. Lifecycle triggers so EVERY creation path stays correct ──────────────

create or replace function public.properties_seed_status_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_property_status_defaults(new.id);
  return new;
end;
$$;
drop trigger if exists properties_seed_status_defaults_ai on public.properties;
create trigger properties_seed_status_defaults_ai
  after insert on public.properties
  for each row execute function public.properties_seed_status_defaults();

create or replace function public.spaces_sync_default_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.ensure_space_default_list(new.id);
  elsif old.archived_at is distinct from new.archived_at then
    -- The default list lives and dies with its space (tasks keep pointing at
    -- it either way — the FK is restrict).
    update public.lists set archived_at = new.archived_at
      where space_id = new.id and is_default;
  end if;
  return new;
end;
$$;
drop trigger if exists spaces_sync_default_list_aiu on public.spaces;
create trigger spaces_sync_default_list_aiu
  after insert or update of archived_at on public.spaces
  for each row execute function public.spaces_sync_default_list();

-- Changing a space's default set re-points every list that inherits.
create or replace function public.spaces_propagate_status_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.default_status_set_id is distinct from new.default_status_set_id then
    update public.lists
      set status_set_id = public.space_status_set(new.id)
      where space_id = new.id and inherits_statuses;
  end if;
  return new;
end;
$$;
drop trigger if exists spaces_propagate_status_set_au on public.spaces;
create trigger spaces_propagate_status_set_au
  after update of default_status_set_id on public.spaces
  for each row execute function public.spaces_propagate_status_set();

-- A set must keep its open + closed status (ClickUp invariant).
create or replace function public.statuses_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.category in ('open', 'closed') and old.archived_at is null
     and not exists (select 1 from public.statuses
                     where status_set_id = old.status_set_id and id <> old.id
                       and category = old.category and archived_at is null) then
    raise exception 'A status set needs one % status', old.category
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
drop trigger if exists statuses_guard_delete_bd on public.statuses;
create trigger statuses_guard_delete_bd
  before delete on public.statuses
  for each row execute function public.statuses_guard_delete();

-- ── 9. Backfill ─────────────────────────────────────────────────────────────

do $$
declare
  p record;
  s record;
begin
  for p in select id from public.properties loop
    perform public.ensure_property_status_defaults(p.id);
  end loop;
  for s in select id from public.spaces loop
    perform public.ensure_space_default_list(s.id);
  end loop;
end;
$$;

-- Bypass the resolver during the bulk fill (it would run per row anyway, but
-- the direct form is faster and makes the mapping explicit).
alter table public.tasks disable trigger tasks_a_resolve_container_status_biu;

update public.tasks t
  set list_id = public.default_list_for(t.property_id, t.space_id)
  where t.list_id is null;

update public.tasks t
  set status_id = public.resolve_legacy_status(l.status_set_id, t.status)
  from public.lists l
  where l.id = t.list_id and t.status_id is null;

-- completed_at: the last done-transition the outbox saw, else updated_at.
update public.tasks t
  set completed_at = coalesce(
    (select max(e.received_at) from public.workflow_events e
      where e.entity_id = t.id and e.event_type = 'task.status_changed'
        and e.payload->>'to' = 'done'),
    t.updated_at)
  where t.status = 'done' and t.completed_at is null;

alter table public.tasks enable trigger tasks_a_resolve_container_status_biu;

alter table public.tasks alter column list_id set not null;
alter table public.tasks alter column status_id set not null;

-- Sanity
do $$
declare
  n int;
begin
  select count(*) into n from public.tasks where list_id is null or status_id is null;
  if n > 0 then raise exception 'backfill left % tasks without list/status', n; end if;
  select count(*) into n from public.status_sets ss
    where archived_at is null and (
      not exists (select 1 from public.statuses where status_set_id = ss.id and category = 'open' and archived_at is null)
      or not exists (select 1 from public.statuses where status_set_id = ss.id and category = 'closed' and archived_at is null));
  if n > 0 then raise exception '% status sets lack an open or closed status', n; end if;
  select count(*) into n from public.tasks t join public.statuses s on s.id = t.status_id
    where t.status <> public.legacy_status_of(s.category, s.is_blocked);
  if n > 0 then raise exception '% tasks have a stale legacy status projection', n; end if;
end;
$$;

comment on column public.tasks.status is
  'LEGACY PROJECTION of status_id (category → todo|in_progress|blocked|done), maintained by tasks_resolve_container_and_status(). Writable: a legacy write is resolved to a status row of the task''s list.';
comment on column public.tasks.completed_at is
  'Stamped on entering a done|closed status, cleared on leaving. The "is done" predicate for queries.';
