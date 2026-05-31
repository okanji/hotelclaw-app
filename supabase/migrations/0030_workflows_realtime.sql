-- Publish the `workflows` table to Supabase Realtime.
--
-- 0026_workflows.sql published `workflow_runs`, `workflow_step_runs`, and
-- `workflow_events`, but not the `workflows` table itself. The workflows list
-- (components/workflows/workflows-list.tsx via lib/workflows/use-workflows-realtime.ts)
-- subscribes to `workflows` so that creating, renaming, enabling/disabling, or
-- deleting a workflow in one session pushes to every other open session.
-- Run-status freshness already flows via the published `workflow_runs` table.
--
-- Idempotent: skip if the table is already a member of the publication (e.g.
-- the migration is re-run against a db where it was applied out of band).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workflows'
  ) then
    alter publication supabase_realtime add table public.workflows;
  end if;
end $$;
