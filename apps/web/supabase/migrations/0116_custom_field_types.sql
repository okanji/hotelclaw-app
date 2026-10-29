-- 0116 — Custom field types (ClickUp parity, Phase 3).
--
-- Temple Point's lists carry currency (KES/EUR/USD), people (Requester, Sales
-- agent), named file slots (LPO, Quote, GRN, POP), email / phone / url, task
-- relationships and auto-progress fields. 0080/0099 had six types.
--
-- Value shapes in task_field_values.value (jsonb):
--   text / long_text / url / email / phone → string
--   number / currency                      → number
--   people                                  → uuid[] (member ids)
--   relation                                → uuid[] (task ids, same property)
--   files                                   → attachment-id[] — DERIVED from
--     task_attachments.field_id by trigger (one source of truth); the app
--     never writes it directly.
--   progress                                → never stored (computed from
--     sub-issues + checklists at read time).
--
-- custom_fields.config (jsonb): currency {code, precision}, people
-- {multiple}, relation {target_list_id?}.

alter table public.custom_fields
  drop constraint custom_fields_type_check;

alter table public.custom_fields
  add constraint custom_fields_type_check
  check (type in (
    'text', 'long_text', 'number', 'currency', 'select', 'multi_select',
    'date', 'checkbox', 'url', 'email', 'phone', 'people', 'files',
    'relation', 'progress'
  ));

alter table public.custom_fields
  add column config jsonb not null default '{}'::jsonb;

comment on column public.custom_fields.config is
  'Per-type settings (0116): currency {code, precision}, people {multiple}, relation {target_list_id}.';

alter table public.task_attachments
  add column field_id uuid references public.custom_fields(id) on delete set null;

create index task_attachments_field_idx
  on public.task_attachments (task_id, field_id) where field_id is not null;

-- ── Computed types are not writable ─────────────────────────────────────────
-- progress is computed at read time; files is derived from task_attachments
-- by the sync trigger below (depth ≥ 2 inside this BEFORE trigger).

create or replace function public.task_field_values_reject_computed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ftype text;
begin
  select type into ftype from public.custom_fields where id = new.field_id;
  if ftype = 'progress' then
    raise exception 'progress fields are computed and cannot be set'
      using errcode = 'check_violation';
  end if;
  if ftype = 'files' and pg_trigger_depth() < 2 then
    raise exception 'files fields are set by attaching a file to the field'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger task_field_values_reject_computed_biu
  before insert or update on public.task_field_values
  for each row execute function public.task_field_values_reject_computed();

-- ── files field ← task_attachments ──────────────────────────────────────────

create or replace function public.task_attachments_sync_files_field()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pairs record;
  ids jsonb;
  prop uuid;
begin
  for pairs in
    select distinct task_id, field_id from (
      select old.task_id as task_id, old.field_id as field_id where tg_op in ('UPDATE', 'DELETE')
      union all
      select new.task_id, new.field_id where tg_op in ('INSERT', 'UPDATE')
    ) x
    where field_id is not null
  loop
    select jsonb_agg(a.id order by a.created_at, a.id) into ids
      from public.task_attachments a
     where a.task_id = pairs.task_id and a.field_id = pairs.field_id;
    if ids is null then
      delete from public.task_field_values
       where task_id = pairs.task_id and field_id = pairs.field_id;
    else
      select property_id into prop from public.tasks where id = pairs.task_id;
      if prop is not null then
        insert into public.task_field_values (task_id, field_id, property_id, value)
        values (pairs.task_id, pairs.field_id, prop, ids)
        on conflict (task_id, field_id) do update set value = excluded.value, updated_at = now();
      end if;
    end if;
  end loop;
  return null;
end;
$$;

create trigger task_attachments_sync_files_field_aiud
  after insert or update of field_id or delete on public.task_attachments
  for each row execute function public.task_attachments_sync_files_field();

-- ── task.field_changed labels for the new types ─────────────────────────────
-- Full restatement of the 0101 body plus: people → names, relation → task
-- titles, files → file names, currency → "KES 1,250.00".

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
  cur_code text;
  cur_prec int;
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
    if old.value is not distinct from new.value then
      return new;
    end if;
    old_value := old.value;
    new_value := new.value;
    the_task_id := new.task_id;
    the_property_id := new.property_id;
    the_field_id := new.field_id;
  end if;

  select name, type, options, config into fld
  from public.custom_fields where id = the_field_id;

  select to_jsonb(t) into task_row from public.tasks t where t.id = the_task_id;

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
  elsif fld.type = 'people' then
    if old_value is not null and jsonb_typeof(old_value) = 'array' then
      select string_agg(coalesce(p.full_name, 'Member'), ', ' order by v.ord) into from_label
      from jsonb_array_elements_text(old_value) with ordinality as v(id, ord)
      left join public.profiles p on p.id::text = v.id;
    end if;
    if new_value is not null and jsonb_typeof(new_value) = 'array' then
      select string_agg(coalesce(p.full_name, 'Member'), ', ' order by v.ord),
             jsonb_agg(coalesce(p.full_name, 'Member') order by v.ord)
        into to_label, to_labels
      from jsonb_array_elements_text(new_value) with ordinality as v(id, ord)
      left join public.profiles p on p.id::text = v.id;
    end if;
  elsif fld.type = 'relation' then
    if old_value is not null and jsonb_typeof(old_value) = 'array' then
      select string_agg(t.title, ', ' order by v.ord) into from_label
      from jsonb_array_elements_text(old_value) with ordinality as v(id, ord)
      join public.tasks t on t.id::text = v.id;
    end if;
    if new_value is not null and jsonb_typeof(new_value) = 'array' then
      select string_agg(t.title, ', ' order by v.ord),
             jsonb_agg(t.title order by v.ord)
        into to_label, to_labels
      from jsonb_array_elements_text(new_value) with ordinality as v(id, ord)
      join public.tasks t on t.id::text = v.id;
    end if;
  elsif fld.type = 'files' then
    if old_value is not null and jsonb_typeof(old_value) = 'array' then
      select string_agg(a.file_name, ', ' order by v.ord) into from_label
      from jsonb_array_elements_text(old_value) with ordinality as v(id, ord)
      join public.task_attachments a on a.id::text = v.id;
    end if;
    if new_value is not null and jsonb_typeof(new_value) = 'array' then
      select string_agg(a.file_name, ', ' order by v.ord),
             jsonb_agg(a.file_name order by v.ord)
        into to_label, to_labels
      from jsonb_array_elements_text(new_value) with ordinality as v(id, ord)
      join public.task_attachments a on a.id::text = v.id;
    end if;
  elsif fld.type = 'currency' then
    cur_code := coalesce(fld.config->>'code', '');
    cur_prec := coalesce((fld.config->>'precision')::int, 2);
    if old_value is not null and jsonb_typeof(old_value) = 'number' then
      from_label := trim(cur_code || ' ' || to_char(round((old_value #>> '{}')::numeric, cur_prec),
        'FM999,999,999,999,990' || case when cur_prec > 0 then '.' || repeat('0', cur_prec) else '' end));
    end if;
    if new_value is not null and jsonb_typeof(new_value) = 'number' then
      to_label := trim(cur_code || ' ' || to_char(round((new_value #>> '{}')::numeric, cur_prec),
        'FM999,999,999,999,990' || case when cur_prec > 0 then '.' || repeat('0', cur_prec) else '' end));
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
