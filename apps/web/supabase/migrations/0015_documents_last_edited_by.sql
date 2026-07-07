-- Track who last changed a document's title or body snippet (best-effort mirror
-- of editor activity). Powers "Edited by …" on the docs home and in the editor.

alter table public.documents
  add column last_edited_by uuid references auth.users(id) on delete set null;

comment on column public.documents.last_edited_by is
  'User who last renamed the doc or synced body_snippet from the editor.';

-- Backfill: treat the creator as the last editor for existing rows.
update public.documents
  set last_edited_by = created_by
  where last_edited_by is null and created_by is not null;
