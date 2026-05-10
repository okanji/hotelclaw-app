-- Unified in-app notification center.
--
-- One row per notification per recipient. Server code inserts via the
-- service-role client; users can only read + mark-seen their own rows.
-- Payload is JSON so each notification type can stash whatever context the
-- UI needs (channel id, task id, sender, etc.) without per-type columns.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Hot path: "give me my unseen notifications, newest first".
create index notifications_user_unseen_idx
  on public.notifications (user_id, created_at desc)
  where seen_at is null;

-- Full-history path: "give me my last N notifications".
create index notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_self" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update_self" on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Deliberately no insert policy — server code uses the service-role client.
-- This prevents a misbehaving frontend from spamming notifications.

-- Enable Realtime delivery for this table so the bell can subscribe to
-- INSERT/UPDATE events scoped to the current user.
alter publication supabase_realtime add table public.notifications;
