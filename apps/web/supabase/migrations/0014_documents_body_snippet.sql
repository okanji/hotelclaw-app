-- Cached plain-text snippet of a document's body — populated client-side by
-- the editor and shown in doc-card previews on the docs home boards. The
-- real content lives in the Liveblocks Yjs doc; this column is best-effort
-- and may lag a few seconds behind the editor.
--
-- Why a Postgres column and not a per-card fetch:
--   The boards strip shows N cards at once. Mounting a Liveblocks room per
--   card just to read the Yjs doc would open N rooms on the home — exactly
--   the cost the rest of the docs UX avoids. Mirroring the first ~500 chars
--   of plain text into a regular column means the home renders from the
--   same single `documents` query it already runs.
alter table public.documents
  add column body_snippet text not null default '';

comment on column public.documents.body_snippet is
  'First ~500 chars of the doc body as plain text. Synced (debounced) by the
   Tiptap editor in components/documents/document-editor.tsx via the
   syncDocumentSnippet server action. Used by the docs-home board cards to
   render a page-thumbnail preview without mounting a Liveblocks room per card.';
