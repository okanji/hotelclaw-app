-- Structured render attachments on bot messages — a small owned card schema
-- (lib/chatbots/cards.ts) the guest chat renders beneath the streamed prose:
-- a service list (name/price/duration + Book), availability slot chips, and
-- booking confirmations. Derived server-side from the booking tools'
-- structured results (check_availability / create_booking) in run-guest-bot's
-- onFinish, so the model never hand-authors them. Null for plain replies.
alter table public.chatbot_messages
  add column if not exists attachments jsonb;
