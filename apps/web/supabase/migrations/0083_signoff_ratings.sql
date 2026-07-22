-- Evaluation checkpoints, phase 1 (D2): the evening sign-off gains a quick
-- manager rating (1–10) + optional note, stamped on every routine_run the
-- sign-off covers. Deterministic averages of these feed the team scoreboard
-- (and later the employee dashboards / leaderboard).

alter table public.routine_runs
  add column rating smallint check (rating between 1 and 10),
  add column rating_note text check (char_length(rating_note) <= 500);
