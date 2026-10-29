-- gr8r Favorites page (2026-10-29) lists starred tasks live. task_favorites'
-- RLS is own-rows only (0022 "task_favorites_own"), so publishing it leaks
-- nothing: Realtime applies the same policy per subscriber.
alter publication supabase_realtime add table public.task_favorites;
