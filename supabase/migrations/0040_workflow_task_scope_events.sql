-- Emit workflow events when a task's Space or Project changes, so workflows can
-- trigger on "task added to a space/project". `to_jsonb(new)` already carries
-- space_id/project_id; we just add the two change-detection branches. The
-- existing `tasks_workflow_events_aiu` trigger calls this function, so replacing
-- the function is all that's needed.

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
    return new;
  end if;

  return null;
end;
$$;
