-- Task dependencies (B4 first slice): task_relations gains a kind.
--   'related' — the existing symmetric "see also" link (default).
--   'blocks'  — directional: task_id BLOCKS related_task_id (the related
--               task can't start until task_id is done).
-- The Gantt/timeline layer reads these for dependency cues; the task detail
-- shows "Blocks" / "Blocked by" badges.
alter table public.task_relations
  add column kind text not null default 'related'
  check (kind in ('related', 'blocks'));
