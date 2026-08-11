-- Custom LABELS (multi-select custom fields) + a configurable list view.
--
-- Two gaps this closes, both learned from ClickUp's model:
--
--  1. ClickUp has THREE tagging concepts and we only had two. `Tags` are
--     space-wide and shared across entities — that's our `labels` catalog
--     (0036) plus `tasks.labels text[]`. `Dropdown` is a single-choice custom
--     field — that's `custom_fields.type = 'select'` (0080). The missing one
--     is `Labels`: the MULTIPLE-choice version of a dropdown, whose option
--     vocabulary is scoped to that one field. That's what lets a property run
--     an independent "Department" and "Risk" vocabulary on the same task
--     without either polluting the shared catalog. Added here as
--     `type = 'multi_select'`, whose stored value is a jsonb ARRAY of option
--     ids (single-select stays a bare string, so nothing existing moves).
--
--     Options also gain an optional `color`, drawn from the same six-tone
--     ramp the `labels` catalog already uses, so a dropdown/label chip can
--     look like a label instead of plain text.
--
--  2. The tasks list view was a hardcoded five-column table. Making columns
--     configurable needs somewhere to remember the layout — which columns,
--     in what order, at what width, sorted by what. `task_view_columns` is
--     that store, keyed per (user, property, view) because column layout is a
--     personal preference, not shared team state (ClickUp scopes it to a
--     saved view; we scope it to the person until saved views exist).

-- ── 1. multi_select ──────────────────────────────────────────────────────────

alter table public.custom_fields
  drop constraint custom_fields_type_check;

alter table public.custom_fields
  add constraint custom_fields_type_check
  check (type in ('text', 'number', 'select', 'multi_select', 'date', 'checkbox'));

comment on column public.custom_fields.options is
  'Option list for select / multi_select: [{id, label, color?}]. `id` is what
   values store, so renaming or recoloring an option never breaks stored data.';

comment on column public.task_field_values.value is
  'jsonb, shape depends on the field type: text/select/date -> string,
   number -> number, checkbox -> bool, multi_select -> array of option ids.';

-- ── 2. Workflow trigger hardening ────────────────────────────────────────────
--
-- Two fixes to the 0080 trigger, both needed before the list view starts
-- writing these rows from inline cell edits:
--
--   • It read `coalesce(new.field_id, old.field_id)` — but on DELETE the NEW
--     record is unassigned, so clearing a field value could abort the delete.
--     Each branch now captures the field id explicitly.
--   • `old.value = new.value` is NULL-safe for jsonb scalars but compares
--     arrays by exact ordering; `is not distinct from` is the correct
--     no-op test now that multi_select values are arrays.

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

  select name, type into fld from public.custom_fields where id = the_field_id;

  perform public.emit_workflow_event(
    the_property_id, 'pg.tasks', 'task.field_changed', the_task_id, 'task',
    jsonb_build_object(
      'field_id', the_field_id,
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

-- ── 3. List view column layout ───────────────────────────────────────────────
--
-- `columns` is an ordered array of { id, width, hidden? } — `id` is either a
-- built-in column key ("title", "priority", "labels", …) or `field:<uuid>`
-- for a custom field, mirroring the board's existing facet addressing.
-- `sort` is { columnId, dir } or null; null means manual order, which is the
-- only mode in which drag-to-reorder is offered (ClickUp's rule — a manual
-- drag while sorted has nowhere to persist to).

create table public.task_view_columns (
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Which surface's table this layout belongs to. One today; the column keeps
  -- My Tasks / project-scoped lists from fighting over one row later.
  view_key text not null default 'tasks:list'
    check (char_length(view_key) between 1 and 60),
  columns jsonb not null default '[]'::jsonb,
  sort jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, property_id, view_key)
);

alter table public.task_view_columns enable row level security;

-- Personal preference: you only ever see or write your own row, and only for
-- a property you belong to.
create policy "task_view_columns_own" on public.task_view_columns
  for all using (user_id = (select auth.uid()) and public.is_member(property_id))
  with check (user_id = (select auth.uid()) and public.is_member(property_id));
