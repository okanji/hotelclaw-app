/**
 * Timeline seeder — gives Solana Cove tasks dates the Timeline view can plot.
 *
 * The demo seed dated everything in June 2026, so the Timeline's rolling
 * 4-week window (Monday of the current week → +27 days) shows nothing. This
 * re-dates tasks relative to TODAY:
 *
 *   • done          → scheduled ranges in the 3 weeks BEFORE this week, so
 *                     stepping back with "<" shows completed work.
 *   • in_progress   → ranges straddling today (started, still running).
 *   • blocked       → ranges that started and have already blown past their
 *                     due date, or are about to — the "this is late" read.
 *   • todo          → ranges spread across the next 4 weeks, milestone-only
 *                     for roughly a third (due_at with no range) so both bar
 *                     and diamond rendering are exercised.
 *
 * ~25% of tasks in each status are deliberately left dateless so the
 * "No date — N" lane stays populated and honest.
 *
 * Re-runnable: dates are a deterministic function of (task id, status), so a
 * second run against the same day writes identical values.
 *
 * Run: node --env-file=.env.local --no-network-family-autoselection scripts/seed-timeline-demo.mjs
 */
import { createClient } from "@supabase/supabase-js";

const PROPERTY_ID =
  process.env.SEED_PROPERTY_ID ?? "d58fc73b-9077-404d-9f2b-6eb56902d91a";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: property } = await supabase
  .from("properties")
  .select("id, name")
  .eq("id", PROPERTY_ID)
  .single();
if (!property) {
  console.error(`Property ${PROPERTY_ID} not found.`);
  process.exit(1);
}

/** Deterministic hash so re-runs land identical data. */
function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const MS_DAY = 86_400_000;
/** Monday of the current week — the Timeline's default anchor. */
const weekStart = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();
/** Day offset from weekStart, at a given hour, as an ISO timestamp. */
const at = (dayOffset, hour) =>
  new Date(weekStart.getTime() + dayOffset * MS_DAY + hour * 3_600_000)
    .toISOString();

/**
 * Date plan per status. Offsets are days from Monday of this week, so the
 * Timeline's default window is days 0..27.
 */
function plan(task) {
  const h = hash(task.id);
  // Leave ~1 in 4 dateless so the "No date" lane isn't empty.
  if (h % 4 === 0) {
    return { scheduled_start: null, scheduled_end: null, due_at: null };
  }

  switch (task.status) {
    case "done": {
      // 3 weeks behind this week: days -21..-2.
      const start = -21 + (h % 17);
      const span = 1 + (h % 3);
      return {
        scheduled_start: at(start, 9),
        scheduled_end: at(start + span, 17),
        due_at: at(start + span, 17),
      };
    }
    case "in_progress": {
      // Straddles today: starts 1-6 days back, runs 2-8 days forward.
      const start = -1 - (h % 6);
      const span = 3 + (h % 7);
      return {
        scheduled_start: at(start, 9),
        scheduled_end: at(start + span, 17),
        due_at: at(start + span, 17),
      };
    }
    case "blocked": {
      // Started well before today and still running — the range overruns
      // into the window while due_at sits behind the now-line, so the bar
      // reads as work that has already blown its date.
      const start = -8 - (h % 5);
      const end = 2 + (h % 6);
      return {
        scheduled_start: at(start, 9),
        scheduled_end: at(end, 17),
        due_at: at(-1 - (h % 4), 17),
      };
    }
    default: {
      // todo — spread across the visible window, days 0..26.
      const start = h % 25;
      // A third are milestone-only: a due date with no committed range.
      if (h % 3 === 0) {
        return {
          scheduled_start: null,
          scheduled_end: null,
          due_at: at(start + 1, 17),
        };
      }
      const span = 1 + (h % 5);
      return {
        scheduled_start: at(start, 9),
        scheduled_end: at(start + span, 17),
        due_at: at(start + span, 17),
      };
    }
  }
}

const { data: tasks, error } = await supabase
  .from("tasks")
  .select("id, title, status")
  .eq("property_id", PROPERTY_ID);
if (error) throw error;

console.log(
  `Re-dating ${tasks.length} tasks in ${property.name} ` +
    `(week of ${weekStart.toDateString()})\n`,
);

const counts = { bar: 0, milestone: 0, none: 0 };
for (const task of tasks) {
  const dates = plan(task);
  const { error: upErr } = await supabase
    .from("tasks")
    .update(dates)
    .eq("id", task.id)
    .eq("property_id", PROPERTY_ID);
  if (upErr) {
    console.error(`  ✗ ${task.title}: ${upErr.message}`);
    continue;
  }
  if (dates.scheduled_start) counts.bar += 1;
  else if (dates.due_at) counts.milestone += 1;
  else counts.none += 1;
}

console.log(
  `  ${counts.bar} scheduled ranges · ${counts.milestone} due-date only · ` +
    `${counts.none} left dateless`,
);
