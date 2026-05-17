-- Notion-style document nesting.
--
-- A document can now live inside another document, forming a tree. The
-- hierarchy is app-state (Postgres), NOT Liveblocks — each doc still owns its
-- own Yjs room for content; only the parent/child/order relationship is
-- stored here so the sidebar tree, breadcrumbs, and in-editor sub-page blocks
-- can render without parsing any Yjs.

-- parent_id: null = top-level document. Self-referencing FK. `on delete
-- cascade` only ever fires on hard property deletion (0009 cascades documents
-- from properties) — day-to-day removal is soft-delete via archived_at.
alter table public.documents
  add column parent_id uuid references public.documents(id) on delete cascade;

-- Sibling ordering, same sparse-float scheme as tasks (see 0010): a doc
-- dropped between two neighbours takes their midpoint, no renumbering.
alter table public.documents
  add column position double precision not null default 0;

-- Backfill: existing docs are all top-level. Space them out within each
-- property, newest first, to match the sidebar's previous "updated_at desc".
with ranked as (
  select
    id,
    row_number() over (
      partition by property_id, parent_id
      order by updated_at desc
    ) as rn
  from public.documents
)
update public.documents d
set position = ranked.rn * 1024
from ranked
where d.id = ranked.id;

-- Tree reads: "active children of <parent> in <property>, in order".
create index documents_tree_order_idx
  on public.documents (property_id, parent_id, position)
  where archived_at is null;

-- ============================================================================
-- Recursive archive / restore.
--
-- Archiving a document trashes its whole subtree (Notion semantics); restoring
-- brings the subtree back. supabase-js can't express a recursive CTE, so the
-- traversal lives in these SECURITY INVOKER functions — RLS on `documents`
-- still applies, so a caller can only touch their own property's docs.
-- ============================================================================

create or replace function public.archive_document_tree(root uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  with recursive subtree as (
    select id from public.documents where id = root
    union all
    select d.id
    from public.documents d
    join subtree s on d.parent_id = s.id
  )
  update public.documents
  set archived_at = now()
  where id in (select id from subtree)
    and archived_at is null;
$$;

create or replace function public.restore_document_tree(root uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_active boolean;
begin
  -- If the original parent is gone or still archived, detach the restored
  -- subtree to the top level so it can't be orphaned out of reach.
  select exists (
    select 1
    from public.documents child
    join public.documents parent on parent.id = child.parent_id
    where child.id = root
      and parent.archived_at is null
  )
  into parent_active;

  if not parent_active then
    update public.documents set parent_id = null where id = root;
  end if;

  with recursive subtree as (
    select id from public.documents where id = root
    union all
    select d.id
    from public.documents d
    join subtree s on d.parent_id = s.id
  )
  update public.documents
  set archived_at = null
  where id in (select id from subtree)
    and archived_at is not null;
end;
$$;
