import {
  addDays,
  cadenceStartOnOrBefore,
  type DateStr,
} from "./dates";

/**
 * Which cycles should exist, given a team's cadence and what's already been
 * materialised. Pure — `ensureCycles` (lib/cycles/ensure.ts) does the I/O.
 *
 * The model (Linear's): cycles are back-to-back windows of `duration_weeks`
 * weeks starting on `start_weekday`. There is always a CURRENT cycle covering
 * today plus `upcoming_count` planned ones after it. A cadence that went quiet
 * (cycles disabled for a month) resumes at the window containing today
 * instead of back-filling every missed cycle — and never overlaps the last
 * cycle that did exist.
 */

export type CycleCadence = {
  duration_weeks: number;
  start_weekday: number;
  upcoming_count: number;
};

export type CycleWindow = {
  number: number;
  starts_on: DateStr;
  ends_on: DateStr;
};

export type CyclePhase = "past" | "current" | "upcoming";

export function cyclePhase(
  c: { starts_on: DateStr; ends_on: DateStr },
  today: DateStr,
): CyclePhase {
  if (c.ends_on < today) return "past";
  if (c.starts_on > today) return "upcoming";
  return "current";
}

/** The cycle covering `today`, if one exists. */
export function currentCycleOf<T extends { starts_on: DateStr; ends_on: DateStr }>(
  cycles: T[],
  today: DateStr,
): T | null {
  return cycles.find((c) => cyclePhase(c, today) === "current") ?? null;
}

/** Hard stop so a pathological input can never insert an unbounded run. */
const MAX_NEW = 12;

export function planNewCycles(
  cadence: CycleCadence,
  existing: CycleWindow[],
  today: DateStr,
): CycleWindow[] {
  const length = 7 * Math.min(8, Math.max(1, cadence.duration_weeks));
  const aligned = cadenceStartOnOrBefore(today, cadence.start_weekday);

  let lastNumber = 0;
  let lastEnd: DateStr | null = null;
  for (const c of existing) {
    if (c.number > lastNumber) lastNumber = c.number;
    if (lastEnd === null || c.ends_on > lastEnd) lastEnd = c.ends_on;
  }

  let cursor: DateStr;
  if (lastEnd === null) cursor = aligned;
  else if (lastEnd >= today) cursor = addDays(lastEnd, 1);
  else {
    const next = addDays(lastEnd, 1);
    cursor = next > aligned ? next : aligned;
  }

  let hasCurrent = existing.some((c) => cyclePhase(c, today) === "current");
  // A hand-edited gap (today falls between two existing cycles) can't be
  // filled by appending — don't loop trying to create a current cycle that
  // would have to start in the past of a later one.
  const needCurrent = !hasCurrent && !(lastEnd !== null && lastEnd >= today);
  let upcoming = existing.filter((c) => c.starts_on > today).length;

  const out: CycleWindow[] = [];
  while (
    out.length < MAX_NEW &&
    ((needCurrent && !hasCurrent) || upcoming < cadence.upcoming_count)
  ) {
    const starts_on = cursor;
    const ends_on = addDays(starts_on, length - 1);
    out.push({ number: ++lastNumber, starts_on, ends_on });
    const phase = cyclePhase({ starts_on, ends_on }, today);
    if (phase === "current") hasCurrent = true;
    else if (phase === "upcoming") upcoming++;
    cursor = addDays(ends_on, 1);
  }
  return out;
}

/** "Cycle 12", or the cycle's own name when it has one. */
export function cycleLabel(c: { number: number; name?: string | null }) {
  return c.name?.trim() ? c.name : `Cycle ${c.number}`;
}
