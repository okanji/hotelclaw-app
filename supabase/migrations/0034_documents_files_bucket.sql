-- ============================================================================
-- documents-files Storage bucket
--
-- Companion to `documents-images` (migration 0009). Holds non-image
-- attachments referenced by the document editor's FileAttachment block —
-- PDFs, common office formats, plain text, archives, audio, and video.
--
-- Same path layout (`{property_id}/{document_id}/{uuid}.{ext}`) and the
-- same property-member RLS pattern so a tenant can only write into their
-- own folders. Bucket is public so the rendered links work without signed
-- URLs; tenant isolation lives in the path + the RLS write policies.
--
-- Size limit 50 MiB — bigger than images (10 MiB) because PDFs and short
-- audio/video clips routinely run larger. Bump if real usage demands it.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents-files',
  'documents-files',
  true,
  50 * 1024 * 1024,
  array[
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- Plain
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    -- Archives
    'application/zip',
    'application/x-zip-compressed',
    -- Audio
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    -- Video
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT: bucket is public so the rendered link works. Keep the policy explicit.
create policy "documents_files_select_all"
  on storage.objects
  for select
  using (bucket_id = 'documents-files');

create policy "documents_files_insert_member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'documents-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "documents_files_update_member"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'documents-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'documents-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "documents_files_delete_member"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'documents-files'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
