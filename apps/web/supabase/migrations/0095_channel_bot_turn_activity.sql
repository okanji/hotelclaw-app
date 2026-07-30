-- Progress line for the "AI is thinking" row.
--
-- The indicator (components/chat/ai-thinking-indicator.tsx) is driven by
-- channel_bot_sessions.turn_state, which is a boolean-ish claim: it says the
-- bot is working, never WHAT it is doing. A turn that reads five documents
-- and rewrites them runs for minutes behind a static "thinking…" row (the
-- 2026-07-28 prod trace: 97s before the first artifact card appeared).
--
-- turn_activity is a short human label the runtime advances as the turn moves
-- through tool calls ("Reading documents…", "Writing SOP: …"), cleared when
-- the turn parks. Deliberately NOT token-level streaming: eve channel event
-- handlers run as durable workflow steps, so a per-delta handler would cost a
-- function invocation per token. This costs a handful of UPDATEs per turn.
--
-- No RLS or publication work needed: 0078_property_brains.sql already grants
-- members SELECT on this table and adds it to supabase_realtime, so the new
-- column rides the existing postgres_changes subscription.

alter table public.channel_bot_sessions
  add column turn_activity text;
