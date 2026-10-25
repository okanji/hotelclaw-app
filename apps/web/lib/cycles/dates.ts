/**
 * Calendar-date math for cycles. Cycles are INCLUSIVE ranges of local dates
 * (`YYYY-MM-DD`) in the property's own calendar, so everything here works on
 * date strings and never on instants: "today" is resolved once, in the
 * property's IANA timezone, and the rest is pure day arithmetic done in UTC
 * (where no day is ever 23 or 25 hours long).
 *
 * Client-safe — no server imports.
 */

/** A local calendar date, `YYYY-MM-DD`. */
export type DateStr = string;

const DAY_MS = 86_400_000;

function toUtcMs(d: DateStr): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, day ?? 1);
}

function fromUtcMs(ms: number): DateStr {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Whole days from `a` to `b` (`b - a`). */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday — the same convention as `cycle_settings`. */
export function weekdayOf(d: DateStr): number {
  return new Date(toUtcMs(d)).getUTCDay();
}

/** Every date from `start` to `end`, inclusive. Empty when end < start. */
export function eachDay(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/**
 * The calendar date an instant falls on in `timeZone`. An unknown zone (or
 * none) falls back to UTC rather than throwing — a bad `properties.timezone`
 * must never take the cycles page down.
 */
export function localDate(
  instant: Date | string | number,
  timeZone?: string | null,
): DateStr {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return fromUtcMs(0);
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** The most recent `startWeekday` on or before `today`. */
export function cadenceStartOnOrBefore(
  today: DateStr,
  startWeekday: number,
): DateStr {
  const back = (weekdayOf(today) - startWeekday + 7) % 7;
  return addDays(today, -back);
}

/** "Oct 23" (+ ", 2025" when not `refYear`). Renders in UTC so it never shifts. */
export function formatDay(d: DateStr, refYear?: number): string {
  const date = new Date(toUtcMs(d));
  const year = date.getUTCFullYear();
  return date.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(refYear !== undefined && year !== refYear ? { year: "numeric" } : {}),
  });
}

/** "Oct 23 → Nov 5". */
export function formatRange(start: DateStr, end: DateStr, refYear?: number) {
  return `${formatDay(start, refYear)} → ${formatDay(end, refYear)}`;
}
