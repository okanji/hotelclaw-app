-- ============================================================================
-- documents: icon + cover_url
--
-- Notion-style document header. Both nullable text columns on the existing
-- `documents` row — covers are URLs pointing into the `documents-images`
-- bucket (uploaded via the existing /api/documents/images/upload route),
-- icons are a single unicode emoji or a short symbol the user picked.
-- Kept on the row rather than a side table because they're tiny, always
-- 1:1 with the doc, and load alongside every other doc field anyway.
-- ============================================================================

alter table public.documents
  add column if not exists icon text,
  add column if not exists cover_url text;
