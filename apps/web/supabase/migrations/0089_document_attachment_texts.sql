-- Text extraction for document file attachments (PDF etc. — the class-C
-- knowledge silo: files were stored in the `documents-files` bucket with no
-- extraction, invisible to FTS, the brain mirror, and every bot).
--
-- Two pieces:
--   • document_attachment_texts — one row per extracted file (idempotency
--     key = storage_path), written by lib/documents/attachment-text.ts at
--     upload time + the backfill script. Service-client writes only;
--     members read.
--   • documents.attachments_text — per-document aggregate the extractor
--     rebuilds; folded into body_fts at weight C (below title/body) so
--     attachment matches rank under authored content, and inherited by the
--     brain mirror via doc-sync reading it alongside body_text.

create table public.document_attachment_texts (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null,
  mime          text not null,
  text_content  text not null default '',
  extracted_at  timestamptz not null default now()
);

create index document_attachment_texts_document_idx
  on public.document_attachment_texts (document_id);

alter table public.document_attachment_texts enable row level security;

create policy document_attachment_texts_select on public.document_attachment_texts
  for select using (public.is_member(property_id));
-- No member write policies: rows are written by the service client
-- (extraction runs server-side with the file bytes in hand).

-- Aggregate + FTS rebuild. body_fts is a generated column (0019, rebuilt in
-- 0024 to include sheet_text) — regenerate with attachments at weight C.
alter table public.documents
  add column attachments_text text not null default '';

drop index if exists documents_body_fts_idx;
alter table public.documents drop column body_fts;
alter table public.documents
  add column body_fts tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(
        to_tsvector(
          'english',
          coalesce(body_text, '') || ' ' || coalesce(sheet_text, '')
        ),
        'B'
      ) ||
      setweight(to_tsvector('english', coalesce(attachments_text, '')), 'C')
    ) stored;

create index documents_body_fts_idx on public.documents using gin (body_fts);

comment on table public.document_attachment_texts is
  'Extracted plaintext of files uploaded to the documents-files bucket.
   One row per storage object; aggregate mirrored to
   documents.attachments_text for FTS + the brain mirror.';
comment on column public.documents.attachments_text is
  'Concatenated extracted text of this doc''s file attachments (rebuilt by
   lib/documents/attachment-text.ts). Weight C in body_fts.';
