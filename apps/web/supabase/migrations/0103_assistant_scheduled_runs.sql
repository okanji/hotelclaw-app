-- Scheduled assistant runs (Assistant → project → Scheduled).
--
-- A schedule is a REAL workflow (`schedule.cron` trigger → one
-- `action.assistant.run` step), exactly the write-through pattern the Forms
-- "submissions become tasks" panel uses — so a schedule stays visible and
-- editable in the Workflows section rather than living in a parallel system.
--
-- What a run PRODUCES is an ordinary conversation in the project. That is the
-- whole design: the output is not an email or a static digest, it is a live
-- thread you can open and reply to, with the project's instructions, memory,
-- and context already loaded. These two columns are what let the UI tell a
-- scheduled conversation apart from one you started, and trace it back to the
-- schedule that made it.

alter table public.assistant_chats
  add column source text not null default 'user'
    check (source in ('user', 'scheduled')),
  -- No FK: deleting a workflow must not cascade away the conversations it
  -- produced. They are the record of work that actually happened.
  add column workflow_id uuid;

create index assistant_chats_workflow_idx
  on public.assistant_chats (workflow_id, last_message_at desc)
  where workflow_id is not null;
