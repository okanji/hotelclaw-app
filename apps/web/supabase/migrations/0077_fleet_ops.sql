-- Fleet ops UI (approvals inbox + live sessions): bot_chat_sessions grows a
-- park state so the app can list awaiting-approval sessions without reading
-- eve streams, and joins the realtime publication so the sidebar/badge
-- update by push. pending_approval shape:
--   { requests: [{ toolName, input, callId }], requestedAt, channelId }
-- Writes stay service-only (no member write policies on the tenancy spine);
-- the existing is_client_member SELECT policy already covers reads.

alter table public.bot_chat_sessions
  add column if not exists status text not null default 'idle'
    check (status in ('idle', 'awaiting_approval')),
  add column if not exists pending_approval jsonb;

create index if not exists bot_chat_sessions_pending_idx
  on public.bot_chat_sessions (property_id, status)
  where status = 'awaiting_approval';

alter publication supabase_realtime add table public.bot_chat_sessions;
