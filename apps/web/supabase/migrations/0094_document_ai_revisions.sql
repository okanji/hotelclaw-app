-- Undo safety net for AI document writes (lib/documents/write-body.ts).
--
-- update_document(mode: replace) overwrites a doc's Liveblocks body and
-- its Postgres snapshot in one motion — before this table, a confused
-- prompt (or an unattended background job holding the same grants) could
-- irreversibly destroy real content. Now every replace of a non-trivial
-- body stashes the prior snapshot here first, capped at the 10 newest
-- revisions per document. Restore is manual for now (paste body_text /
-- future restore tool can replay body_json through write-body).

create table public.document_ai_revisions (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  body_json    jsonb,
  body_text    text not null default '',
  note         text,
  replaced_at  timestamptz not null default now()
);

create index document_ai_revisions_document_idx
  on public.document_ai_revisions (document_id, replaced_at desc);

alter table public.document_ai_revisions enable row level security;

create policy document_ai_revisions_select on public.document_ai_revisions
  for select using (public.is_member(property_id));
-- No member write policies: rows are written by the service client from
-- the AI write path only.
