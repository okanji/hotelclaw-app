-- Dry runs (the run inspector's "Test" button and the builder's test-run)
-- previously wrote indistinguishable workflow_runs rows, polluting run history
-- and the success-rate stats on the home/insights widgets. Mark them so the
-- UI can badge them and stats queries can exclude them.

alter table workflow_runs
  add column if not exists is_dry_run boolean not null default false;

-- Stats queries filter on (property_id, is_dry_run, started_at).
create index if not exists workflow_runs_property_dry_idx
  on workflow_runs (property_id, started_at desc)
  where is_dry_run = false;
