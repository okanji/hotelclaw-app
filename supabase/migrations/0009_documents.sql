-- Collaborative documents (Tiptap + Liveblocks).
--
-- Each row is metadata + soft-delete state for a Liveblocks room
-- (`property:{property_id}:doc:{id}`). The document content itself lives in
-- the Yjs doc managed by Liveblocks — Postgres only holds the title and
-- lifecycle fields, so the sidebar/list views don't need to parse Yjs.
--
-- Soft-delete via `archived_at` mirrors `chat_channels` (see 0005). Hard
-- deletes are intentionally not exposed: keeping rows lets us reopen archived
-- docs and preserves thread/comment context recorded against the room id.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null default 'Untitled document',
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sidebar tree: "active docs for this property, most recently edited first".
create index documents_property_active_recent_idx
  on public.documents (property_id, updated_at desc)
  where archived_at is null;

-- Archive view + per-document lookups stay fast even with soft-deleted rows.
create index documents_property_archived_idx
  on public.documents (property_id, archived_at);

-- Reuse the trigger function from 0001_init.sql.
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

-- Any property member can read / create / update (rename, archive, restore).
-- No DELETE policy — soft-delete only.
create policy "documents_select_member" on public.documents
  for select using (public.is_member(property_id));

create policy "documents_insert_member" on public.documents
  for insert with check (public.is_member(property_id));

create policy "documents_update_member" on public.documents
  for update using (public.is_member(property_id));

-- Realtime: sidebar tree subscribes for INSERT/UPDATE so create/rename/archive
-- propagate across browsers without polling.
alter publication supabase_realtime add table public.documents;

-- ============================================================================
-- Storage bucket: document images (uploaded via the Tiptap Image extension).
-- Path layout: `{property_id}/{document_id}/{uuid}.{ext}`.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents-images',
  'documents-images',
  true,
  10 * 1024 * 1024, -- 10 MiB
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public bucket needs an explicit SELECT policy so the dashboard/list works
-- and the public URL stays readable.
create policy "documents_images_select_all"
  on storage.objects
  for select
  using (bucket_id = 'documents-images');

-- Writes: a user can only upload into a property they're a member of. The
-- API route enforces the document_id segment too, but tying the storage RLS
-- to property membership keeps things safe even if the route is bypassed.
create policy "documents_images_insert_member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'documents-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "documents_images_update_member"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'documents-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'documents-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "documents_images_delete_member"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'documents-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
