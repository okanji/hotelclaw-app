-- Server-side snapshot of a document's body, fed by the Liveblocks
-- `ydocUpdated` webhook (see `app/api/liveblocks/webhook/route.ts`). Replaces
-- the client-driven `body_snippet` plumbing from migration 0014: now the
-- snapshot is lossless (full Yjs binary update) and the preview/search text
-- is the full plaintext rather than a 500-char head.
--
-- The point of writing this back to Postgres is durability and portability —
-- Liveblocks remains the live-edit layer, but `body_state` is the canonical
-- source of truth. Push it back into any Yjs-compatible provider (Liveblocks
-- via `sendYjsBinaryUpdate`, Hocuspocus, y-sweet, self-hosted ws) with
-- `Y.applyUpdate(new Y.Doc(), bytes)` and you have the full doc back.
--
-- Columns:
--   body_state      — `Y.encodeStateAsUpdate(ydoc)` output. Single binary
--                     update encoding the entire doc; typical size 1–50 KB.
--   body_text       — Plaintext extracted via `withProsemirrorDocument`
--                     `editor.getText()`. Feeds full-text search (body_fts)
--                     and the docs-home page-thumbnail previews.
--   body_json       — Tiptap ProseMirror JSON. Useful for SSR / AI prompts /
--                     non-Yjs rendering. Nullable: we can rebuild it from
--                     body_state if needed, but storing it avoids that work.
--   body_updated_at — When the snapshot was last written. A future safety-net
--                     cron can find stale rows where `updated_at` ran ahead
--                     of `body_updated_at` (missed webhook delivery).
--   body_fts        — Generated tsvector over title + body_text, weighted
--                     A=title, B=body. Drives `search_documents_keyword` in
--                     the next migration.

alter table public.documents
  add column body_state      bytea,
  add column body_text       text not null default '',
  add column body_json       jsonb,
  add column body_updated_at timestamptz;

-- Best-effort backfill so search works on day one for docs that already had
-- a 500-char snippet. The scripts/backfill-document-snapshots.ts run after
-- deploy replaces these with the full plaintext.
update public.documents
  set body_text = coalesce(body_snippet, '')
  where body_text = '';

-- Generated full-text vector. Weighted: title matches outrank body matches
-- via ts_rank_cd. `english` config gives stemming + stopword removal — good
-- enough default; revisit per-property locale if we ever go non-English.
alter table public.documents
  add column body_fts tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')),     'A') ||
      setweight(to_tsvector('english', coalesce(body_text, '')), 'B')
    ) stored;

create index documents_body_fts_idx on public.documents using gin (body_fts);

comment on column public.documents.body_state is
  'Yjs binary update from Y.encodeStateAsUpdate(ydoc). Written by the
   Liveblocks ydocUpdated webhook; replayable into any Yjs provider.';
comment on column public.documents.body_text is
  'Full plaintext of the doc body. Drives body_fts and the page-thumbnail
   preview on the docs home (sliced to ~240 chars client-side).';
comment on column public.documents.body_json is
  'Tiptap ProseMirror JSON. Useful for SSR/AI without rehydrating Yjs.';
comment on column public.documents.body_fts is
  'Generated tsvector over title (A) + body_text (B). GIN-indexed.';

-- body_snippet superseded by body_text. The old client-side
-- `useSnippetSync` debounce (in document-editor.tsx) is removed in the same
-- change; nothing else writes to this column.
alter table public.documents drop column body_snippet;
