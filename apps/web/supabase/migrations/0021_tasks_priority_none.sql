-- Adds a "none" priority value to `tasks.priority`, matching Linear's
-- "No priority" option. Existing rows keep their current priority; only
-- the CHECK constraint and the default change.
--
-- The default flips from 'medium' to 'none' so newly created tasks start
-- unprioritised (the user explicitly sets priority via the on-card chip).

alter table public.tasks
  drop constraint if exists tasks_priority_check;

alter table public.tasks
  add constraint tasks_priority_check
    check (priority in ('none', 'low', 'medium', 'high', 'urgent'));

alter table public.tasks
  alter column priority set default 'none';
