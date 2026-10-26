-- Channel-bot turn trace (2026-10-26).
--
-- channel_bot_activity (0096) stored one LABEL per step — enough for a
-- "Reading “Freezer SOP”…" progress line, not enough to show what the agent
-- actually did. The chat now renders each turn the way eve's own reference
-- channel does (node_modules/eve/docs/channels/slack.mdx "Delivery" / "Task
-- card"): one row per action with its status and settlement, tasks with how
-- they ended, the reasoning summary, the parked questions / approvals, and
-- the turn's token usage. The web reads the rows for a delivered message by
-- (channel_id, thread_key, turn_nonce) — the message already carries
-- `eve_turn` — so the trace is unbounded by Stream's ~5KB message cap.
--
-- Every column is nullable or defaulted: the old `label`-only writers (and
-- mobile's `eve_steps` consumer) keep working unchanged.

alter table public.channel_bot_activity
  -- What kind of step this row is. `step` = the legacy label-only row.
  --   thinking | reasoning | tool | skill | subagent | task | question |
  --   approval | waiting | step
  add column kind       text not null default 'step',
  -- eve's own ids, so a result / settlement can find the row it closes.
  add column call_id    text,
  add column task_id    text,
  add column tool_name  text,
  -- Bounded copies of the action's input / output (the runtime clips them
  -- before writing — this is a trace, not the audit log).
  add column input      jsonb,
  add column output     jsonb,
  -- Free text: the reasoning summary, a task's "how it ended" sentence, an
  -- error message, a question's prompt.
  add column detail     text,
  -- running | completed | failed | rejected | cancelled
  add column status     text not null default 'completed',
  add column settled_at timestamptz;

-- Settle-by-id lookups (action.result → its actions.requested row;
-- task.settled → its task.started row).
create index channel_bot_activity_call_idx
  on public.channel_bot_activity (channel_id, thread_key, turn_nonce, call_id)
  where call_id is not null;

create index channel_bot_activity_task_idx
  on public.channel_bot_activity (channel_id, thread_key, turn_nonce, task_id)
  where task_id is not null;

-- Realtime already publishes INSERTs for this table (0096); the trace now
-- also settles rows in place, so UPDATEs must carry the full row.
alter table public.channel_bot_activity replica identity full;

-- Per-turn token usage, accumulated from eve's step.completed events
-- ({inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd,
-- steps, modelId}). Reset by the web glue when it opens the next turn.
alter table public.channel_bot_sessions
  add column turn_usage jsonb;
