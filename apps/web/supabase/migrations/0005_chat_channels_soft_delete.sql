-- Soft-delete + archive support for chat channels.
--
-- Channels are now archived rather than hard-deleted, so message history and
-- audit context survive. A partial unique index enforces "no two active
-- channels with the same name in a property" while letting an archived row
-- keep its name for reference.

alter table public.chat_channels
  add column archived_at timestamptz;

-- Reconcile pre-existing duplicates so the partial unique index can be
-- created. Keep the oldest row's name as-is; suffix newer duplicates with
-- the first 4 chars of their uuid (same scheme restoreChannel uses on
-- collision). Stream channel names are left untouched — they live on
-- Stream's side and the user can rename via channel settings.
with ranked as (
  select id,
         row_number() over (
           partition by property_id, name
           order by created_at asc, id asc
         ) as rn
  from public.chat_channels
)
update public.chat_channels c
   set name = c.name || '-' || substr(c.id::text, 1, 4)
  from ranked r
 where r.id = c.id
   and r.rn > 1;

create unique index chat_channels_property_active_name_key
  on public.chat_channels (property_id, name)
  where archived_at is null;

create index chat_channels_property_active_idx
  on public.chat_channels (property_id)
  where archived_at is null;
