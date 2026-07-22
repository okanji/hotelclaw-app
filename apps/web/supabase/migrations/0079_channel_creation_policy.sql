-- Who can create chat channels — Slack-style workspace policy. Default keeps
-- today's behavior (any member); management can restrict creation to
-- owners/managers before rolling chat out to a whole team. Enforced in the
-- createChannel server action; the existing properties_update_owner_manager
-- RLS policy already gates who can change the setting.
alter table public.properties
  add column channel_creation text not null default 'everyone'
  check (channel_creation in ('everyone', 'management'));
