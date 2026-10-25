"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/cycles/dates";
import { ensureCycles } from "@/lib/cycles/ensure";

const Uuid = z.string().uuid();

const SettingsSchema = z.object({
  propertyId: Uuid,
  /** null = the property-wide cadence. */
  spaceId: Uuid.nullable(),
  enabled: z.boolean(),
  durationWeeks: z.number().int().min(1).max(8),
  startWeekday: z.number().int().min(0).max(6),
  upcomingCount: z.number().int().min(1).max(6),
  autoRollover: z.boolean(),
});

/**
 * Create or update a team's cycle cadence, then materialise it.
 *
 * Changing the shape of the cadence (length or start day) regenerates the
 * UPCOMING cycles that have nothing planned in them yet — an empty future
 * cycle is just a placeholder, and keeping it would leave the new cadence
 * waiting behind two old-shaped windows. Planned ones (with tasks) stay put;
 * the new cadence starts after them. Current and past cycles never change.
 *
 * Writes run under the caller's RLS (`cycle_settings` / `cycles` are
 * member-writable), so a non-member can't touch another property.
 */
export async function saveCycleSettings(
  input: z.input<typeof SettingsSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid settings" };
  const s = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const row = {
    enabled: s.enabled,
    duration_weeks: s.durationWeeks,
    start_weekday: s.startWeekday,
    upcoming_count: s.upcomingCount,
    auto_rollover: s.autoRollover,
  };

  const scope = <Q extends { eq: (c: "space_id", v: string) => Q; is: (c: "space_id", v: null) => Q }>(q: Q) =>
    s.spaceId ? q.eq("space_id", s.spaceId) : q.is("space_id", null);

  const { data: before } = await scope(
    supabase
      .from("cycle_settings")
      .select("id, duration_weeks, start_weekday")
      .eq("property_id", s.propertyId),
  ).maybeSingle();

  if (before) {
    const { error } = await supabase
      .from("cycle_settings")
      .update(row)
      .eq("id", before.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("cycle_settings").insert({
      property_id: s.propertyId,
      space_id: s.spaceId,
      ...row,
    });
    // A concurrent first save — the row exists now; update it instead.
    if (error?.code === "23505") {
      const retry = await scope(
        supabase
          .from("cycle_settings")
          .update(row)
          .eq("property_id", s.propertyId),
      );
      if (retry.error) return { error: retry.error.message };
    } else if (error) {
      return { error: error.message };
    }
  }

  const reshaped =
    before &&
    (before.duration_weeks !== s.durationWeeks ||
      before.start_weekday !== s.startWeekday);
  if (reshaped) {
    const { data: property } = await supabase
      .from("properties")
      .select("timezone")
      .eq("id", s.propertyId)
      .maybeSingle();
    const today = localDate(new Date(), property?.timezone);
    const { data: upcoming } = await scope(
      supabase
        .from("cycles")
        .select("id")
        .eq("property_id", s.propertyId)
        .gt("starts_on", today),
    );
    const ids = (upcoming ?? []).map((c) => c.id);
    if (ids.length > 0) {
      const { data: planned } = await supabase
        .from("tasks")
        .select("cycle_id")
        .in("cycle_id", ids);
      const busy = new Set((planned ?? []).map((t) => t.cycle_id));
      const empty = ids.filter((id) => !busy.has(id));
      if (empty.length > 0) {
        await supabase.from("cycles").delete().in("id", empty);
      }
    }
  }

  if (s.enabled) {
    try {
      await ensureCycles(supabase, s.propertyId, s.spaceId);
    } catch (e) {
      console.error("[cycles] ensure after settings save failed", e);
    }
  }

  revalidatePath(`/p/${s.propertyId}/cycles`);
  return { ok: true };
}

const RenameSchema = z.object({
  cycleId: Uuid,
  name: z.string().trim().max(80).nullable(),
});

/** Name a cycle ("Pre-season deep clean"); empty restores "Cycle N". */
export async function renameCycle(
  input: z.input<typeof RenameSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid name" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycles")
    .update({ name: parsed.data.name ? parsed.data.name : null })
    .eq("id", parsed.data.cycleId)
    .select("property_id")
    .maybeSingle();
  if (error || !data) return { error: error?.message ?? "Cycle not found" };
  revalidatePath(`/p/${data.property_id}/cycles`);
  return { ok: true };
}
