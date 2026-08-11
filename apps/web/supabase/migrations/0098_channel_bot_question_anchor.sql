-- Background jobs that can PARK AND ASK mid-run.
--
-- Until now a background job (channel_bot_sessions.kind='job') ran detached
-- with its brief stating verbatim that "nobody can answer follow-up
-- questions". A job that hit an unknown had two options: invent an answer or
-- write a "TO CONFIRM" placeholder into the deliverable. It picked the second
-- (observed 2026-08-11: an SOP gap-fill job left three TO CONFIRM blocks in a
-- freezer SOP rather than asking who the refrigeration contractor is).
--
-- eve already supports the fix — `ask_question` parks any session durably at
-- `session.waiting` for as long as it takes (docs/tools/human-in-the-loop).
-- What was missing was a ROUTE BACK: chat sessions are keyed by
-- (channel_id, thread_key) and the webhook resolves thread_key from the
-- message's parent_id, but job rows carry a synthetic `job:<uuid>` thread key
-- that no incoming message can ever produce. So a job's question had no
-- answer path.
--
-- question_message_id is that route. When a turn parks on a question, the
-- delivery step records the Stream message id the question was posted as;
-- a reply IN THAT MESSAGE'S THREAD is unambiguously an answer to that
-- session, whichever session it belongs to. Cleared on every turn that
-- parks without questions, so a stale anchor can't capture later replies.

alter table public.channel_bot_sessions
  add column question_message_id text;

-- The webhook's hot lookup: "is this thread reply answering a parked
-- session?" runs on every inbound thread message, so it must be indexed.
-- Partial — only parked sessions carry an anchor.
create index channel_bot_sessions_question_msg_idx
  on public.channel_bot_sessions (question_message_id)
  where question_message_id is not null;
