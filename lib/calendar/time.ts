/**
 * Date math the calendar needs that the standard `Date` API doesn't ship.
 * Everything here is timezone-naive — operations happen in the caller's
 * local time, which is exactly what the grid renders. ISO strings cross the
 * wire; `Date` lives only inside components.
 *
 * Week starts on Monday. (Switchable later by reading the user's profile.)
 */

export const WEEK_START: 0 | 1 = 1;

/** First moment of the day containing `d`. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Last moment of the day containing `d` (23:59:59.999). */
export function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** First moment of the week containing `d`, Monday-start. */
export function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const day = out.getDay();
  const diff = (day - WEEK_START + 7) % 7;
  out.setDate(out.getDate() - diff);
  return out;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const out = new Date(start);
  out.setDate(out.getDate() + 7);
  return out;
}

export function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function endOfMonth(d: Date): Date {
  const out = startOfMonth(d);
  out.setMonth(out.getMonth() + 1);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Length of a day in minutes; useful as the grid height denominator. */
export const MINUTES_PER_DAY = 24 * 60;

/** Convert a wall-clock time on `day` to minutes from midnight. */
export function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** A 7-element array of dates spanning the week containing `d`. */
export function weekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** A 6-row grid (42 cells) of dates for the month containing `d` — month-view mini cal. */
export function monthGrid(d: Date): Date[] {
  const first = startOfMonth(d);
  const startWeekday = (first.getDay() - WEEK_START + 7) % 7;
  const gridStart = addDays(first, -startWeekday);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Snap minutes-from-midnight to the nearest `grain` minute boundary. */
export function snapToGrain(minutes: number, grain: number): number {
  return Math.round(minutes / grain) * grain;
}

/**
 * Lay out overlapping events in a single day. Classic two-pass column
 * algorithm:
 *   1. Sweep events in start order; for each, place it in the lowest column
 *      whose last event has already ended.
 *   2. After all placements, group columns into clusters that mutually
 *      overlap and divide the available width by the cluster's column count.
 *
 * Returns each event's `{ column, columns }` so the renderer can compute
 * `left` and `width` (column * 100 / columns, width = 100 / columns).
 */
export function layoutColumns<T extends { start: Date; end: Date }>(
  events: T[],
): Array<{ event: T; column: number; columns: number }> {
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const placements: Array<{ event: T; column: number; end: Date }> = [];
  const columnEnds: Date[] = [];

  for (const ev of sorted) {
    let placed = -1;
    for (let i = 0; i < columnEnds.length; i++) {
      if (columnEnds[i] <= ev.start) {
        placed = i;
        columnEnds[i] = ev.end;
        break;
      }
    }
    if (placed === -1) {
      placed = columnEnds.length;
      columnEnds.push(ev.end);
    }
    placements.push({ event: ev, column: placed, end: ev.end });
  }

  // Cluster: walk in start order; while the current event overlaps anything
  // already in the cluster, extend the cluster; otherwise flush.
  type Out = { event: T; column: number; columns: number };
  const result: Out[] = [];
  let cluster: typeof placements = [];
  let clusterEnd = new Date(0);

  function flush() {
    const columns =
      cluster.reduce((m, p) => Math.max(m, p.column + 1), 0) || 1;
    for (const p of cluster) {
      result.push({ event: p.event, column: p.column, columns });
    }
    cluster = [];
  }

  for (const p of placements) {
    if (p.event.start >= clusterEnd && cluster.length > 0) {
      flush();
    }
    cluster.push(p);
    if (p.end > clusterEnd) clusterEnd = p.end;
  }
  if (cluster.length > 0) flush();

  return result;
}
