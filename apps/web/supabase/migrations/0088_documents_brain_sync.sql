-- Document → knowledge-brain mirror cursor (lib/brain/doc-sync.ts).
--
-- Every active document is mirrored into the property's gbrain source as a
-- `documents/<id>` page (put_page on the Liveblocks snapshot webhook +
-- nightly reconciliation cron; delete_page on archive). Postgres stays the
-- canonical store — the brain page is a derived index, rebuilt idempotently.
--
-- brain_synced_at records the last successful mirror operation (put OR
-- delete). A document needs syncing when:
--   • brain_synced_at is null and the doc is active, or
--   • body_updated_at  > brain_synced_at (content drifted), or
--   • archived_at      > brain_synced_at (archive not yet mirrored).

alter table public.documents
  add column brain_synced_at timestamptz;

comment on column public.documents.brain_synced_at is
  'Last successful mirror into the property''s gbrain source (put_page or
   delete_page). Null = never mirrored. See lib/brain/doc-sync.ts.';

-- The nightly sweep filters on staleness across all properties.
create index documents_brain_sync_idx
  on public.documents (brain_synced_at nulls first, body_updated_at);
