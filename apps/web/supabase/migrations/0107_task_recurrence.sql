-- 0107: recurring tasks.
--
-- Room inspections, preventive maintenance, minibar audits — the hotel
-- workload that repeats on a cadence but is still ONE job with one owner
-- (unlike `routines` (0082), which are per-team recurring CHECKLISTS). gr8r's
-- model, ported: a task carries a repeat cadence; when it is completed the
-- next occurrence is created with the due date pushed forward, the same
-- owner/team/project/labels, and sub-issues reset (not copied). The copy is
-- made in `lib/tasks/mutations.ts:updateTaskFor` — the shared write path web
-- and mobile both run — so it fires for every completion that goes through
-- the app. Completions by raw DB writes (workflows that set status directly)
-- do NOT roll forward; that is deliberate until a trigger-based version is
-- wanted.
--
-- `recurrence_of` links each occurrence to the task it was rolled from, so
-- a chain can be followed in either direction.

alter table public.tasks
  add column if not exists recurrence text
    check (recurrence in ('daily', 'weekly', 'biweekly', 'monthly')),
  add column if not exists recurrence_of uuid references public.tasks(id) on delete set null;

create index if not exists tasks_recurrence_of_idx
  on public.tasks (recurrence_of)
  where recurrence_of is not null;

comment on column public.tasks.recurrence is
  'Repeat cadence. On completion the app inserts the next occurrence (due_at shifted by the cadence) and leaves this one done.';
