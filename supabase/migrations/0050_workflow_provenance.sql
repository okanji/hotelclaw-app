-- Provenance for workflow-created records. Runners stamp created rows with
-- created_by = workflow owner, which makes automation output indistinguishable
-- from the owner acting by hand ("Alice created a task at 3am"). These columns
-- record WHAT created the row so the UI can badge automation output and link
-- back to the exact run.
--
-- source: 'user' (default, human-created), 'workflow', or 'ai' (in-app bots).
-- source_workflow_id / source_workflow_run_id: set when source = 'workflow'.

alter table tasks
  add column if not exists source text not null default 'user'
    check (source in ('user', 'workflow', 'ai')),
  add column if not exists source_workflow_id uuid references workflows(id) on delete set null,
  add column if not exists source_workflow_run_id uuid references workflow_runs(id) on delete set null;

alter table documents
  add column if not exists source text not null default 'user'
    check (source in ('user', 'workflow', 'ai')),
  add column if not exists source_workflow_id uuid references workflows(id) on delete set null,
  add column if not exists source_workflow_run_id uuid references workflow_runs(id) on delete set null;

alter table entities
  add column if not exists source text not null default 'user'
    check (source in ('user', 'workflow', 'ai')),
  add column if not exists source_workflow_id uuid references workflows(id) on delete set null,
  add column if not exists source_workflow_run_id uuid references workflow_runs(id) on delete set null;

-- "Everything workflow X created" lookups.
create index if not exists tasks_source_workflow_idx
  on tasks (source_workflow_id) where source_workflow_id is not null;
create index if not exists documents_source_workflow_idx
  on documents (source_workflow_id) where source_workflow_id is not null;
create index if not exists entities_source_workflow_idx
  on entities (source_workflow_id) where source_workflow_id is not null;
