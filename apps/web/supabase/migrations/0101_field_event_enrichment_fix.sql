-- Custom-fields correctness fixes (ClickUp-parity audit, 2026-08-12).
--
-- 1) Re-apply 0081's task.field_changed enrichment ON TOP of 0099's body.
--    0099 recreated `task_field_values_emit_workflow_events` (for the
--    multi_select CHECK + DELETE-branch field capture + `is not distinct
--    from` no-op test) but was written against 0080's payload, silently
--    dropping 0081's `from_label` / `to_label` / `task` keys — the seeded
--    maintenance-material-tracking template renders "{{trigger.task.title}}"
--    and both labels as empty strings since then. This version is the union:
--    0099's control flow + 0081's enrichment, extended to resolve
--    multi_select id-arrays to comma-joined labels (0081 only handled
--    select).
--
-- 2) Drop the member DELETE policy on custom_fields. No app surface deletes
--    a field definition (archival is the lifecycle), but the open policy let
--    any staff member hard-delete a property-wide field via the API —
--    cascading away every stored value. task_field_values keeps its delete
--    policy: clearing a value IS a row delete.
--
-- 3) Publish custom_fields + task_field_values to Realtime. Field edits and
--    value edits by one user previously reached other sessions only via
--    30-60s staleTime expiry; the tasks board now subscribes and invalidates.

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
  the_field_id uuid;
  task_row jsonb;
  from_label text;
  to_label text;
  to_labels jsonb;
begin
  if (tg_op = 'DELETE') then
    old_value := old.value;
    new_value := null;
    the_task_id := old.task_id;
    the_property_id := old.property_id;
    the_field_id := old.field_id;
  elsif (tg_op = 'INSERT') then
    old_value := null;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    the_field_id := new.field_id;
  else
    -- NULL-safe and array-order-aware no-op test (0099). The app writes
    -- multi_select arrays in canonical (definition) order so a pure reorder
    -- never reaches the DB as a distinct value.
    if old.value is not distinct from new.value then
      return new;
    end if;
    old_value := old.value;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    the_field_id := new.field_id;
  end if;

  select name, type, options into fld
  from public.custom_fields where id = the_field_id;

  select to_jsonb(t) into task_row from public.tasks t where t.id = the_task_id;

  -- Resolve option ids to labels so steps can template
  -- "{{trigger.from_label}} → {{trigger.to_label}}" without joins.
  if fld.type = 'select' then
    if old_value is not null then
      select o->>'label' into from_label
      from jsonb_array_elements(fld.options) o
      where o->>'id' = old_value #>> '{}';
    end if;
    if new_value is not null then
      select o->>'label' into to_label
      from jsonb_array_elements(fld.options) o
      where o->>'id' = new_value #>> '{}';
    end if;
  elsif fld.type = 'multi_select' then
    if old_value is not null then
      select string_agg(opt->>'label', ', ' order by v.ord) into from_label
      from jsonb_array_elements_text(old_value) with ordinality as v(id, ord)
      join jsonb_array_elements(fld.options) as opt on opt->>'id' = v.id;
    end if;
    if new_value is not null then
      select string_agg(opt->>'label', ', ' order by v.ord),
             jsonb_agg(opt->>'label' order by v.ord)
        into to_label, to_labels
      from jsonb_array_elements_text(new_value) with ordinality as v(id, ord)
      join jsonb_array_elements(fld.options) as opt on opt->>'id' = v.id;
    end if;
  end if;

  perform public.emit_workflow_event(
    the_property_id, 'pg.tasks', 'task.field_changed', the_task_id, 'task',
    jsonb_build_object(
      'field_id', the_field_id,
      'field_name', fld.name,
      'field_type', fld.type,
      'from', old_value,
      'to', new_value,
      'from_label', coalesce(from_label, old_value #>> '{}'),
      'to_label', coalesce(to_label, new_value #>> '{}'),
      -- Label ARRAY for multi_select (null otherwise) — the "becomes X"
      -- trigger filter matches with `in` against this, so a task landing on
      -- ["VIP","Rush"] still matches "becomes VIP" exactly (the joined
      -- to_label string can't be equality- or substring-matched safely).
      'to_labels', to_labels,
      'task', task_row
    )
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

drop policy if exists "custom_fields_delete_member" on public.custom_fields;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'custom_fields'
  ) then
    alter publication supabase_realtime add table public.custom_fields;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_field_values'
  ) then
    alter publication supabase_realtime add table public.task_field_values;
  end if;
end $$;
