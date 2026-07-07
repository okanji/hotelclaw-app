-- Keyword document search backed by the `body_fts` tsvector added in 0018.
-- Phase 1 of the search story — keyword only. Phase 2 (separate migration)
-- will add a body_embedding column + HNSW index + a hybrid_search() that
-- merges this with semantic results via Reciprocal Rank Fusion.
--
-- `websearch_to_tsquery` understands quoted phrases, `or`, and negation — the
-- query syntax a user already knows from any search box. `ts_rank_cd`
-- (cover-density) weights matches by proximity, so "cancellation policy" as
-- a phrase outranks two distant mentions of either word.
--
-- security invoker is correct here: the documents table has RLS that
-- enforces `property_id` membership via the existing `is_member` policy
-- (see 0009_documents.sql), and `security invoker` means this function
-- runs as the calling user, so RLS still applies. No need to re-check
-- membership inside the function.

create or replace function public.search_documents_keyword(
  property_id_param uuid,
  query_text        text,
  match_count       int default 20
)
returns table (
  id          uuid,
  title       text,
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
    d.id,
    d.title,
    left(d.body_text, 240)                as preview,
    d.updated_at,
    ts_rank_cd(d.body_fts, q.tsq)         as rank
  from public.documents d
  cross join q
  where d.property_id  = property_id_param
    and d.archived_at  is null
    and q.tsq          <> ''::tsquery
    and d.body_fts     @@ q.tsq
  order by rank desc, d.updated_at desc
  limit greatest(1, least(coalesce(match_count, 20), 50));
$$;

comment on function public.search_documents_keyword(uuid, text, int) is
  'Keyword search over title + body_text for a property''s active documents.
   Ranked by ts_rank_cd, capped at 50 results. RLS-aware via security invoker.';

grant execute on function public.search_documents_keyword(uuid, text, int)
  to authenticated;
