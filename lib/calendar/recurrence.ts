import type { MeetingRecurrence } from "@/lib/db/types";

/**
 * Recurrence expansion — given a meeting with `recurrence`, materialise
 * the individual occurrences that fall inside a `[windowFrom, windowTo)`
 * window. A deliberately small RRULE subset:
 *
 *   * frequency: "daily" | "weekly" | "monthly"
 *   * interval: every N (e.g. 2 = every other week)
 *   * until: stop date (inclusive)
 *   * count: max occurrences (in series order, not in-window)
 *   * byday: 1–7 (Mon=1, Sun=7) — only meaningful with frequency="weekly"
 *
 * No: BYMONTHDAY, BYMONTH, BYSETPOS, exceptions, time-zoned RRULEs. If we
 * grow into those it's worth importing `rrule` proper; for v1 the savings
 * are real (the rrule package is ~50KB minified).
 *
 * Each generated occurrence keeps the parent meeting's id with an
 * `occurrence_<isoStart>` suffix so the renderer can distinguish them but
 * still route edits/deletes to the underlying row.
 */
export function expandRecurrence<
  T extends {
    id: string;
    scheduled_start: string;
    scheduled_end: string;
    recurrence: MeetingRecurrence | null;
  },
>(
  meeting: T,
  windowFrom: Date,
  windowTo: Date,
): Array<T & { occurrence_id: string }> {
  if (!meeting.recurrence) {
    return [{ ...meeting, occurrence_id: meeting.id }];
  }
  const rule = meeting.recurrence;
  const start = new Date(meeting.scheduled_start);
  const end = new Date(meeting.scheduled_end);
  const duration = end.getTime() - start.getTime();
  const interval = Math.max(1, rule.interval || 1);
  const until = rule.until ? new Date(rule.until) : null;
  const count = rule.count ?? Number.POSITIVE_INFINITY;

  const out: Array<T & { occurrence_id: string }> = [];

  // We hard-cap iterations so a broken rule (e.g. interval=0 slipping
  // through, or a count in the millions) can't pin the server.
  const HARD_CAP = 1_000;
  let generated = 0;

  // For weekly with byday, expand a "week step" then emit one occurrence
  // per requested weekday inside that step.
  const cursor = new Date(start);
  while (
    cursor < windowTo &&
    (!until || cursor <= until) &&
    generated < count &&
    generated < HARD_CAP
  ) {
    if (rule.frequency === "weekly" && rule.byday && rule.byday.length > 0) {
      // For each requested weekday in this week-step, emit the matching
      // dateOnly occurrence at the same time-of-day as the seed.
      for (const isoDay of rule.byday) {
        const occurrence = atIsoWeekday(cursor, isoDay);
        if (occurrence < start) continue; // never before the seed
        if (occurrence >= windowTo) break;
        if (until && occurrence > until) break;
        if (occurrence >= windowFrom) {
          out.push(makeOccurrence(meeting, occurrence, duration));
        }
        generated++;
        if (generated >= count || generated >= HARD_CAP) break;
      }
    } else {
      if (cursor >= windowFrom && cursor < windowTo) {
        out.push(makeOccurrence(meeting, cursor, duration));
      }
      generated++;
    }
    advance(cursor, rule.frequency, interval);
  }

  return out;
}

function makeOccurrence<
  T extends { id: string; scheduled_start: string; scheduled_end: string },
>(meeting: T, occurrenceStart: Date, durationMs: number): T & {
  occurrence_id: string;
} {
  const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
  return {
    ...meeting,
    scheduled_start: occurrenceStart.toISOString(),
    scheduled_end: occurrenceEnd.toISOString(),
    occurrence_id: `${meeting.id}@${occurrenceStart.toISOString()}`,
  };
}

function advance(
  d: Date,
  frequency: MeetingRecurrence["frequency"],
  interval: number,
): void {
  if (frequency === "daily") {
    d.setDate(d.getDate() + interval);
  } else if (frequency === "weekly") {
    d.setDate(d.getDate() + 7 * interval);
  } else if (frequency === "monthly") {
    d.setMonth(d.getMonth() + interval);
  }
}

/**
 * Return the date that's the same week as `weekAnchor` and falls on the
 * requested ISO weekday (1=Mon … 7=Sun), keeping the time-of-day from
 * `weekAnchor`.
 */
function atIsoWeekday(weekAnchor: Date, isoDay: number): Date {
  const out = new Date(weekAnchor);
  const currentIso = ((out.getDay() + 6) % 7) + 1; // Sun(0) → 7
  out.setDate(out.getDate() + (isoDay - currentIso));
  return out;
}
