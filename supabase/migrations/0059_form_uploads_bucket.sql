-- ============================================================================
-- form-uploads Storage bucket
--
-- Files attached to form responses via the "Attachment" field type —
-- mainly photos for maintenance/incident forms, plus PDFs and short
-- clips. Same conventions as `documents-files` (migration 0034): path is
-- `{property_id}/{form_id}/{uuid}.{ext}`, bucket is public so rendered
-- links work without signed URLs, and tenant isolation lives in the path
-- + the property-member RLS write policies.
--
-- 25 MiB ceiling — enough for phone photos and short videos.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-uploads',
  'form-uploads',
  true,
  25 * 1024 * 1024,
  array[
    -- Images (the main case: maintenance photos)
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    -- Audio / video clips
    'audio/mpeg',
    'audio/mp4',
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
create policy "form_uploads_select_all"
  on storage.objects
  for select
  using (bucket_id = 'form-uploads');

create policy "form_uploads_insert_member"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'form-uploads'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

create policy "form_uploads_delete_member"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'form-uploads'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
