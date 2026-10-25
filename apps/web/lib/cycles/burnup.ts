import type { TaskStatus } from "@/lib/db/types";
import { addDays, eachDay, localDate, type DateStr } from "./dates";
import { scopeStats, type ScopeStats } from "./scope";

/**
 * The burn-up series, rebuilt from `activity_log` rather than stored.
 *
 * We know every task's CURRENT state (status / estimate / cycle) and the log
 * of field changes since (0106 writes completed / reopened / status_changed,
 * 0111 writes estimate_changed / cycle_changed, both with `{from, to}`). So
 * the state at the end of any past day is the current state with every later
 * change UNDONE. Walking backwards from today, one day at a time, gives an
 * exact daily snapshot without a nightly job — and it stays correct when
 * history is edited by rollover, since rollover's moves are logged too.
 *
 * Membership is part of the replay: a task moved OUT of the cycle (or rolled
 * over to the next one) still counts toward the days it was in scope, which
 * is what makes a finished cycle's "% success" honest after its open work
 * has moved on.
 *
 * Client-safe — no server imports.
 */

export type HistoryEvent = {
  entity_id: string;
  verb: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export type BurnupTask = {
  id: string;
  status: TaskStatus;
  estimate: number | null;
  cycle_id: string | null;
};

export type BurnupPoint = {
  date: DateStr;
  /** Null on days that haven't happened yet. */
  scope: number | null;
  started: number | null;
  completed: number | null;
};

export type BurnupResult = {
  points: BurnupPoint[];
  /** Stats on the last measured day (today, or the end of a past cycle). */
  stats: ScopeStats;
  /** Each member's state on that day — feeds the breakdown tabs. */
  members: Map<string, { status: TaskStatus; estimate: number | null }>;
};

const STATUSES = new Set<TaskStatus>(["todo", "in_progress", "blocked", "done"]);
const VERBS = new Set([
  "created",
  "completed",
  "reopened",
  "status_changed",
  "estimate_changed",
  "cycle_changed",
]);

/** The verbs the replay understands — what loaders should fetch. */
export const BURNUP_VERBS = [...VERBS];

type State = BurnupTask & { exists: boolean };

function undo(state: State, e: HistoryEvent) {
  const from = e.detail?.from;
  switch (e.verb) {
    case "created":
      state.exists = false;
      break;
    case "cycle_changed":
      state.cycle_id = typeof from === "string" ? from : null;
      break;
    case "estimate_changed":
      state.estimate = typeof from === "number" ? from : null;
      break;
    default:
      // completed / reopened / status_changed
      if (typeof from === "string" && STATUSES.has(from as TaskStatus)) {
        state.status = from as TaskStatus;
      }
  }
}

export function buildBurnup(input: {
  cycleId: string;
  startsOn: DateStr;
  endsOn: DateStr;
  today: DateStr;
  timeZone?: string | null;
  /** Current state of every task that is, or ever was, in the cycle. */
  tasks: BurnupTask[];
  events: HistoryEvent[];
}): BurnupResult {
  const { cycleId, startsOn, endsOn, today, timeZone } = input;
  const states = new Map<string, State>(
    input.tasks.map((t) => [t.id, { ...t, exists: true }]),
  );

  // Newest first, each tagged with the local day it happened on.
  const events = input.events
    .filter((e) => VERBS.has(e.verb) && states.has(e.entity_id))
    .map((e) => ({ e, day: localDate(e.created_at, timeZone) }))
    .sort((a, b) => (a.e.created_at < b.e.created_at ? 1 : -1));

  const members = () => {
    const out = new Map<string, { status: TaskStatus; estimate: number | null }>();
    for (const s of states.values()) {
      if (s.exists && s.cycle_id === cycleId) {
        out.set(s.id, { status: s.status, estimate: s.estimate });
      }
    }
    return out;
  };

  const lastDay = today < endsOn ? today : endsOn;
  let i = 0;
  // Rewind to the end of the last measured day.
  while (i < events.length && events[i]!.day > lastDay) {
    undo(states.get(events[i]!.e.entity_id)!, events[i]!.e);
    i++;
  }

  const finalMembers = members();
  const measured = new Map<DateStr, ScopeStats>();
  if (lastDay >= startsOn) {
    for (let d = lastDay; d >= startsOn; d = addDays(d, -1)) {
      measured.set(d, scopeStats(members().values()));
      // Step back: undo everything that happened ON day d.
      while (i < events.length && events[i]!.day >= d) {
        undo(states.get(events[i]!.e.entity_id)!, events[i]!.e);
        i++;
      }
    }
  }

  const points = eachDay(startsOn, endsOn).map<BurnupPoint>((date) => {
    const s = measured.get(date);
    return s
      ? { date, scope: s.scope, started: s.started, completed: s.completed }
      : { date, scope: null, started: null, completed: null };
  });

  return {
    points,
    stats: scopeStats(finalMembers.values()),
    members: finalMembers,
  };
}

/**
 * Burn-up for every cycle in a list from one shared task + event load
 * (`loadCycleData`). The replay filters membership per cycle, so passing the
 * whole task set to each is correct — and cheap at cycle-list sizes.
 */
export function buildBurnups(input: {
  cycles: { id: string; starts_on: DateStr; ends_on: DateStr }[];
  today: DateStr;
  timeZone?: string | null;
  tasks: BurnupTask[];
  events: HistoryEvent[];
}): Map<string, BurnupResult> {
  const out = new Map<string, BurnupResult>();
  for (const c of input.cycles) {
    out.set(
      c.id,
      buildBurnup({
        cycleId: c.id,
        startsOn: c.starts_on,
        endsOn: c.ends_on,
        today: input.today,
        timeZone: input.timeZone,
        tasks: input.tasks,
        events: input.events,
      }),
    );
  }
  return out;
}
