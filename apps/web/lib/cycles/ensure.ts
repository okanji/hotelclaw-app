import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import { localDate, type DateStr } from "./dates";
import { currentCycleOf, planNewCycles } from "./plan";

import type { CycleRow, CycleSettingsRow } from "./types";

type Db = SupabaseClient<Database>;
export type { CycleRow, CycleSettingsRow };

/**
 * Lazy materialisation + rollover — there is no cron. Every surface that
 * shows cycles calls this first; it is idempotent and cheap when nothing is
 * due (two reads), so calling it on each page load is the design.
 *
 * 1. Keep the current cycle + `upcoming_count` future ones in existence,
 *    numbered sequentially per (property, team).
 * 2. Close out ended cycles: with `auto_rollover`, move their not-done tasks
 *    into the current cycle (Linear's behaviour), then stamp `completed_at`.
 *
 * Concurrency: two tabs loading at once compute the SAME plan from the same
 * state, so the loser's insert hits the (property, space, number) unique key
 * — 23505 is swallowed and we re-read. The rollover move is a conditional
 * UPDATE (`cycle_id = old AND status <> done`), so running it twice is a
 * no-op, and the stamp is guarded by `completed_at IS NULL`.
 *
 * Reads go through the CALLER's client, so RLS fences the property. The task
 * moves go through the service client so the activity log attributes them to
 * the system rather than to whoever happened to open the page.
 */
export async function ensureCycles(
  supabase: Db,
  propertyId: string,
  spaceId: string | null,
): Promise<{
  settings: CycleSettingsRow | null;
  cycles: CycleRow[];
  today: DateStr;
  timeZone: string;
}> {
  const [settingsRes, propertyRes] = await Promise.all([
    scoped(
      supabase.from("cycle_settings").select("*").eq("property_id", propertyId),
      spaceId,
    ).maybeSingle(),
    supabase
      .from("properties")
      .select("timezone")
      .eq("id", propertyId)
      .maybeSingle(),
  ]);
  const settings = (settingsRes.data as CycleSettingsRow | null) ?? null;
  const timeZone = propertyRes.data?.timezone || "UTC";
  const today = localDate(new Date(), timeZone);

  let cycles = await readCycles(supabase, propertyId, spaceId);
  if (!settings?.enabled) return { settings, cycles, today, timeZone };

  const plan = planNewCycles(settings, cycles, today);
  if (plan.length > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    for (const c of plan) {
      const { error } = await supabase.from("cycles").insert({
        property_id: propertyId,
        space_id: spaceId,
        number: c.number,
        starts_on: c.starts_on,
        ends_on: c.ends_on,
        created_by: user?.id ?? null,
      });
      // A concurrent load got there first — its row is the same window.
      if (error && error.code !== "23505") {
        console.error("[cycles] materialise failed", propertyId, spaceId, error);
        break;
      }
    }
    cycles = await readCycles(supabase, propertyId, spaceId);
  }

  const ended = cycles.filter((c) => c.ends_on < today && !c.completed_at);
  if (ended.length > 0) {
    const current = currentCycleOf(cycles, today);
    const service = createServiceClient();
    const stamp = new Date().toISOString();
    for (const c of ended) {
      // Roll into the cycle covering today; in a hand-edited gap, the next
      // one that hasn't ended yet.
      const target =
        current ??
        cycles.find((n) => n.starts_on > c.ends_on && n.ends_on >= today) ??
        null;
      if (settings.auto_rollover && target) {
        const { error } = await service
          .from("tasks")
          .update({ cycle_id: target.id })
          .eq("property_id", propertyId)
          .eq("cycle_id", c.id)
          .neq("status", "done");
        if (error) {
          // Leave it open so the next load retries the move.
          console.error("[cycles] rollover failed", c.id, error);
          continue;
        }
      }
      await service
        .from("cycles")
        .update({ completed_at: stamp })
        .eq("id", c.id)
        .eq("property_id", propertyId)
        .is("completed_at", null);
      c.completed_at = stamp;
    }
  }

  return { settings, cycles, today, timeZone };
}

/** `ensureCycles` for every enabled cadence in the property. */
export async function ensureAllCycles(supabase: Db, propertyId: string) {
  const { data } = await supabase
    .from("cycle_settings")
    .select("space_id, enabled")
    .eq("property_id", propertyId)
    .eq("enabled", true);
  return Promise.all(
    (data ?? []).map((s) => ensureCycles(supabase, propertyId, s.space_id)),
  );
}

async function readCycles(
  supabase: Db,
  propertyId: string,
  spaceId: string | null,
): Promise<CycleRow[]> {
  const { data, error } = await scoped(
    supabase.from("cycles").select("*").eq("property_id", propertyId),
    spaceId,
  ).order("number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CycleRow[];
}

/** `space_id = x`, or `space_id IS NULL` for the property-wide cadence. */
function scoped<
  Q extends {
    eq: (col: "space_id", v: string) => Q;
    is: (col: "space_id", v: null) => Q;
  },
>(query: Q, spaceId: string | null): Q {
  return spaceId ? query.eq("space_id", spaceId) : query.is("space_id", null);
}
