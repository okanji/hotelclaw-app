-- Spreadsheet documents.
--
-- We treat a spreadsheet as a kind of document — same Liveblocks room
-- (`property:<pid>:doc:<did>`), same table, same lifecycle (archive, restore,
-- nest under a parent, pin to a board). What changes is the room's payload:
-- the Tiptap doc uses Yjs and snapshots into `body_state`; the sheet uses
-- Liveblocks Storage and snapshots into `sheet_state`. The webhook routes on
-- `kind` (and event type — `ydocUpdated` vs `storageUpdated`).
--
-- The split storage columns (instead of overloading `body_state`) preserves
-- backwards-compat with the existing snapshot pipeline + search index, and
-- keeps the Yjs binary blob distinct from the JSON sheet snapshot for any
-- future per-kind tooling (export, AI prompts, etc).

alter table public.documents
  add column kind text not null default 'doc'
    check (kind in ('doc', 'sheet')),
  -- Full sheet state, serialized to JSON by the Liveblocks `storageUpdated`
  -- webhook. Replayable into a fresh room via `storage.set()` to rebuild the
  -- LiveObject/LiveList/LiveMap tree. Shape: see lib/spreadsheet/snapshot.ts.
  add column sheet_state jsonb,
  -- Flat TSV of cell values — used for full-text search and AI prompts.
  -- For a `kind='sheet'` row, body_text remains empty and sheet_text carries
  -- the searchable surface.
  add column sheet_text text,
  add column sheet_updated_at timestamptz;

comment on column public.documents.kind is
  'Document type. ''doc'' = Tiptap rich-text (Yjs). ''sheet'' = spreadsheet (Liveblocks Storage).';
comment on column public.documents.sheet_state is
  'Liveblocks Storage snapshot of a sheet — { cells, columns, rows }. Written by the storageUpdated webhook.';
comment on column public.documents.sheet_text is
  'TSV plaintext of the sheet body. Drives body_fts (extended below) and search.';

-- Extend the generated full-text vector to include sheet_text — same weight
-- as body_text. Postgres requires a drop+recreate for generated columns.
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
      )
    ) stored;

create index documents_body_fts_idx on public.documents using gin (body_fts);

-- Backfill: existing rows are all 'doc' (default already applied). Nothing to
-- do for sheet_state / sheet_text — null is the correct empty state for them.
