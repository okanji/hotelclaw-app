-- Transition-alert state — remembers each subject's last observed condition
-- so alerts fire on the *flip* (on_pace → at_risk, runway crossing under the
-- typical cycle time), not on every sweep while the condition persists.
-- Subjects:
--   project_pace — subject_id = project id, state = the PaceFlag last seen
--   task_slip    — subject_id = task id,   state = 'flagged' | 'clear'
--   meta         — subject_id = property id, state = ISO of the last check
--                  (the per-property hourly throttle for the sweep).

create table public.insight_alert_state (
  property_id uuid not null references public.properties(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('project_pace','task_slip','meta')),
  subject_id uuid not null,
  state text not null,
  updated_at timestamptz not null default now(),
  primary key (property_id, subject_kind, subject_id)
);

-- Sweep-internal bookkeeping; written and read by the cron via the
-- service-role client only.
alter table public.insight_alert_state enable row level security;
