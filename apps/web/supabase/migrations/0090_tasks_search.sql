-- Task full-text search (knowledge-silo audit: tasks were reachable only as
-- an open-task list — done-task knowledge was invisible to every bot, and
-- "have we ever had a task about X" was unanswerable).
--
-- Same shape as the documents pair (0019/0020): generated tsvector
-- (title A, description B) + a keyword-search RPC.

alter table public.tasks
  add column search_fts tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B')
    ) stored;

create index tasks_search_fts_idx on public.tasks using gin (search_fts);

-- NOTE ON TENANCY (also corrects the 0020 claim for search_documents_keyword):
-- these RPCs are `security invoker`, but the AI runtimes call them through
-- the SERVICE ROLE, which bypasses RLS entirely. On that path the
-- property_id_param IS the tenancy gate — it is always taken from the
-- session's verified auth attributes, never from model arguments. RLS
-- protects only the authenticated browser path.
create or replace function public.search_tasks_keyword(
  property_id_param uuid,
  query_text        text,
  include_done      boolean default true,
  match_count       int default 20
)
returns table (
  id          uuid,
  title       text,
  status      text,
  priority    text,
  due_at      timestamptz,
  assignee_id uuid,
  preview     text,
  updated_at  timestamptz,
  rank        real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as tsq
  )
  select
    t.id,
    t.title,
    t.status,
    t.priority,
    t.due_at,
    t.assignee_id,
    left(coalesce(t.description, ''), 240) as preview,
    t.updated_at,
    ts_rank_cd(t.search_fts, q.tsq)        as rank
  from public.tasks t
  cross join q
  where t.property_id = property_id_param
    and q.tsq         <> ''::tsquery
    and t.search_fts  @@ q.tsq
    and (include_done or t.status <> 'done')
  order by rank desc, t.updated_at desc
  limit greatest(1, least(coalesce(match_count, 20), 50));
$$;

comment on function public.search_tasks_keyword(uuid, text, boolean, int) is
  'Keyword search over title + description for a property''s tasks (done
   included by default). property_id_param is the tenancy gate on
   service-role calls; RLS covers the invoker path.';

grant execute on function public.search_tasks_keyword(uuid, text, boolean, int)
  to authenticated;

comment on function public.search_documents_keyword(uuid, text, int) is
  'Keyword search over title + body_text for a property''s active documents.
   Ranked by ts_rank_cd, capped at 50 results. TENANCY: security invoker +
   RLS covers browser callers, but the AI runtimes call this via the
   SERVICE ROLE (RLS bypassed) — on that path property_id_param is the
   gate and always comes from verified session attributes (see
   apps/agent/agent/tools/catalog.ts).';
