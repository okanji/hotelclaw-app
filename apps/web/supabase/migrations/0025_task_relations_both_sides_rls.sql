-- Tighten task_relations RLS so both ends of the relation must belong to a
-- property the caller is a member of, AND both must share the same property.
--
-- Migration 0022 only validated `task_id`'s property, which let a caller link
-- their task to any other task across tenants (or read relations pointing into
-- other tenants' tasks). Cross-property links shouldn't exist at all — the UI
-- never surfaces them and they leak task ids across tenants.

drop policy if exists "task_relations_member" on public.task_relations;

create policy "task_relations_member" on public.task_relations
  for all using (
    exists (
      select 1
      from public.tasks t
      join public.tasks rt on rt.id = task_relations.related_task_id
      where t.id = task_relations.task_id
        and t.property_id = rt.property_id
        and public.is_member(t.property_id)
    )
  )
  with check (
    exists (
      select 1
      from public.tasks t
      join public.tasks rt on rt.id = task_relations.related_task_id
      where t.id = task_relations.task_id
        and t.property_id = rt.property_id
        and public.is_member(t.property_id)
    )
  );
