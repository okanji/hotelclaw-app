-- Kanban board ordering.
--
-- Adds a per-card `position` so the board can persist manual drag-and-drop
-- order *within* each status column. Positions are sparse floating-point
-- values (spaced ~1024 apart) so a card dropped between two neighbours can
-- take the midpoint without renumbering the rest of the column.

alter table public.tasks
  add column position double precision not null default 0;

-- Backfill existing rows: space them out within each (property, status)
-- column, newest first, to match the board's previous "updated_at desc" order.
with ranked as (
  select
    id,
    row_number() over (
      partition by property_id, status
      order by updated_at desc
    ) as rn
  from public.tasks
)
update public.tasks t
set position = ranked.rn * 1024
from ranked
where t.id = ranked.id;

-- Reads always sort a column by (property_id, status, position).
create index tasks_board_order_idx
  on public.tasks (property_id, status, position);
