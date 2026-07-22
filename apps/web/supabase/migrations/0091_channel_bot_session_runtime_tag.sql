-- Runtime tag on channel bot sessions (lib/stream/channel-bot-eve.ts).
--
-- Eve durable sessions persist their dynamic-tool references against the
-- BUILD that created them (lifted step functions __eve_dynamic_exec_N).
-- A deploy that changes the agent's tool surface reorders that registry;
-- resuming an old session on the new build makes eve skip every
-- unmatched tool ("references step function ... which is not registered")
-- and the bot runs TOOLLESS — observed in prod 2026-07-22 after the
-- knowledge-architecture deploy.
--
-- The guard: sessions are stamped with the runtime identity that created
-- them (VERCEL_DEPLOYMENT_ID in prod, a boot UUID in dev). On mismatch the
-- web glue starts a FRESH session instead of resuming. Cost: engaged-mode
-- memory resets on deploy; context packing rebuilds channel context anyway.

alter table public.channel_bot_sessions
  add column runtime_tag text;

comment on column public.channel_bot_sessions.runtime_tag is
  'Identity of the runtime build that created the eve session
   (VERCEL_DEPLOYMENT_ID / dev boot UUID). Mismatch => start fresh rather
   than resume: dynamic-tool registries do not survive across builds.';
