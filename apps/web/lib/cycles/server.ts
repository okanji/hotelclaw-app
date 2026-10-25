import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { addDays } from "./dates";
import { BURNUP_VERBS, type HistoryEvent } from "./burnup";
import type { CycleRow, CycleTask } from "./types";

export type { CycleTask };

type Db = SupabaseClient<Database>;

const TASK_COLS =
  "id, title, status, priority, estimate, cycle_id, assignee_id, labels, project_id, space_id, due_at, parent_id";

/** PostgREST `in.(…)` lives in the URL — keep each list well under limits. */
const CHUNK = 100;
const EVENT_LIMIT = 10_000;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/**
 * Everything the burn-up replay needs for a set of cycles: the current state
 * of every task that is OR WAS in one of them (a rolled-over task now lives
 * in a later cycle, but still belongs to the earlier one's history), plus
 * the planning-relevant activity_log rows since the earliest cycle started.
 *
 * All reads use the caller's client — `activity_log` and `tasks` are both
 * member-SELECT under RLS, and every query is also fenced by property.
 */
export async function loadCycleData(
  supabase: Db,
  propertyId: string,
  cycles: Pick<CycleRow, "id" | "starts_on">[],
): Promise<{ tasks: CycleTask[]; events: HistoryEvent[] }> {
  if (cycles.length === 0) return { tasks: [], events: [] };
  const cycleIds = new Set(cycles.map((c) => c.id));
  const earliest = cycles.reduce(
    (min, c) => (c.starts_on < min ? c.starts_on : min),
    cycles[0]!.starts_on,
  );
  // One day of margin either side of any timezone offset; events before the
  // cycle start are never undone by the replay, so extra ones are harmless.
  const since = `${addDays(earliest, -1)}T00:00:00Z`;

  const [memberRes, movesRes] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .in("cycle_id", [...cycleIds]),
    supabase
      .from("activity_log")
      .select("entity_id, verb, detail, created_at")
      .eq("property_id", propertyId)
      .eq("entity_kind", "task")
      .eq("verb", "cycle_changed")
      .gte("created_at", since)
      .limit(EVENT_LIMIT),
  ]);
  if (memberRes.error) throw new Error(memberRes.error.message);

  const tasks = new Map<string, CycleTask>(
    ((memberRes.data ?? []) as CycleTask[]).map((t) => [t.id, normalise(t)]),
  );
  // Moves that touched one of these cycles, in either direction.
  const moves = ((movesRes.data ?? []) as HistoryEvent[]).filter((e) => {
    const d = e.detail ?? {};
    return (
      cycleIds.has(String(d.from ?? "")) || cycleIds.has(String(d.to ?? ""))
    );
  });

  // Tasks that left — fetch their current state too (deleted ones simply
  // drop out of the replay).
  const missing = [
    ...new Set(moves.map((e) => e.entity_id).filter((id) => !tasks.has(id))),
  ];
  for (const ids of chunks(missing)) {
    const { data } = await supabase
      .from("tasks")
      .select(TASK_COLS)
      .eq("property_id", propertyId)
      .in("id", ids);
    for (const t of (data ?? []) as CycleTask[]) tasks.set(t.id, normalise(t));
  }

  const otherVerbs = BURNUP_VERBS.filter((v) => v !== "cycle_changed");
  const events: HistoryEvent[] = moves.filter((e) => tasks.has(e.entity_id));
  const results = await Promise.all(
    chunks([...tasks.keys()]).map((ids) =>
      supabase
        .from("activity_log")
        .select("entity_id, verb, detail, created_at")
        .eq("property_id", propertyId)
        .eq("entity_kind", "task")
        .in("entity_id", ids)
        .in("verb", otherVerbs)
        .gte("created_at", since)
        .limit(EVENT_LIMIT),
    ),
  );
  for (const r of results) events.push(...((r.data ?? []) as HistoryEvent[]));

  return { tasks: [...tasks.values()], events };
}

function normalise(t: CycleTask): CycleTask {
  return { ...t, labels: t.labels ?? [] };
}
