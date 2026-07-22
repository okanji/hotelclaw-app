-- Custom fields on tasks (ClickUp-style) — the pilot's top structural ask.
--
-- `custom_fields` = the definitions (property-wide, or scoped to one team via
-- space_id). `task_field_values` = one row per (task, field) holding a jsonb
-- value whose shape depends on the field type:
--   text     → "string"          number → 123.45
--   select   → "<option id>"     date   → "2026-07-21" (ISO date string)
--   checkbox → true|false
-- Select options live as [{id, label}] jsonb on the definition; values store
-- the option id so renaming an option never breaks stored values.
--
-- Values feed workflows via a `task.field_changed` trigger event (same
-- pg-trigger pattern as tasks_emit_workflow_events).

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- null = available on every task in the property; set = only tasks in that team
  space_id uuid references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('text', 'number', 'select', 'date', 'checkbox')),
  options jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index custom_fields_property_idx
  on public.custom_fields (property_id, archived_at);

create table public.task_field_values (
  task_id uuid not null references public.tasks(id) on delete cascade,
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  -- denormalized for RLS + the workflow trigger (no join needed)
  property_id uuid not null references public.properties(id) on delete cascade,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (task_id, field_id)
);

create index task_field_values_field_idx
  on public.task_field_values (field_id);
create index task_field_values_property_idx
  on public.task_field_values (property_id);

alter table public.custom_fields enable row level security;
alter table public.task_field_values enable row level security;

-- Same member policies as tasks — fields are ordinary team data.
create policy "custom_fields_select_member" on public.custom_fields
  for select using (public.is_member(property_id));
create policy "custom_fields_insert_member" on public.custom_fields
  for insert with check (public.is_member(property_id));
create policy "custom_fields_update_member" on public.custom_fields
  for update using (public.is_member(property_id));
create policy "custom_fields_delete_member" on public.custom_fields
  for delete using (public.is_member(property_id));

create policy "task_field_values_select_member" on public.task_field_values
  for select using (public.is_member(property_id));
create policy "task_field_values_insert_member" on public.task_field_values
  for insert with check (public.is_member(property_id));
create policy "task_field_values_update_member" on public.task_field_values
  for update using (public.is_member(property_id));
create policy "task_field_values_delete_member" on public.task_field_values
  for delete using (public.is_member(property_id));

-- Workflow trigger: emit task.field_changed whenever a value is set, changed,
-- or cleared. Payload carries the field definition's name/type so workflow
-- filters can match on human-readable names without a join.
create or replace function public.task_field_values_emit_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fld record;
  old_value jsonb;
  new_value jsonb;
  the_task_id uuid;
  the_property_id uuid;
begin
  if (tg_op = 'DELETE') then
    old_value := old.value;
    new_value := null;
    the_task_id := old.task_id;
    the_property_id := old.property_id;
    select name, type into fld from public.custom_fields where id = old.field_id;
  elsif (tg_op = 'INSERT') then
    old_value := null;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    select name, type into fld from public.custom_fields where id = new.field_id;
  else
    if old.value = new.value then
      return new;
    end if;
    old_value := old.value;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    select name, type into fld from public.custom_fields where id = new.field_id;
  end if;

  perform public.emit_workflow_event(
    the_property_id, 'pg.tasks', 'task.field_changed', the_task_id, 'task',
    jsonb_build_object(
      'field_id', coalesce(new.field_id, old.field_id),
      'field_name', fld.name,
      'field_type', fld.type,
      'from', old_value,
      'to', new_value
    )
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

create trigger task_field_values_workflow_events_aiud
  after insert or update or delete on public.task_field_values
  for each row execute function public.task_field_values_emit_workflow_events();
