"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { RoutineItem } from "@/lib/db/types";

// Server actions for daily operations (migration 0082). All writes ride the
// user's RLS client — routines are ordinary member data.

function slugId(label: string): string {
  return (
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) ||
    Math.random().toString(36).slice(2, 10)
  );
}

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  /** Labels — ids are derived server-side. */
  itemLabels: z.array(z.string().min(1).max(200)).min(1).max(40),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export async function createRoutine(
  input: z.input<typeof CreateSchema>,
): Promise<{ id: string } | { error: string }> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const seen = new Set<string>();
  const items: RoutineItem[] = parsed.data.itemLabels.map((label) => {
    let id = slugId(label);
    while (seen.has(id)) id = `${id}-${seen.size}`;
    seen.add(id);
    return { id, label };
  });

  const { data, error } = await supabase
    .from("routines")
    .insert({
      property_id: parsed.data.propertyId,
      space_id: parsed.data.spaceId,
      name: parsed.data.name.trim(),
      items,
      days: [...new Set(parsed.data.days)].sort(),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };
  return { id: data.id };
}

export async function archiveRoutine(
  routineId: string,
): Promise<{ ok: true } | { error: string }> {
  const id = z.string().uuid().safeParse(routineId);
  if (!id.success) return { error: "Invalid routine" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routines")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Routine not found" };
  return { ok: true };
}

const ToggleSchema = z.object({
  propertyId: z.string().uuid(),
  routineId: z.string().uuid(),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  itemId: z.string().min(1).max(80),
  done: z.boolean(),
});

/** Check/uncheck one item on a day's run (lazily creating the run row). */
export async function toggleRoutineItem(
  input: z.input<typeof ToggleSchema>,
): Promise<{ ok: true; completed: boolean } | { error: string }> {
  const parsed = ToggleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();

  // The routine defines the item universe (completion = every item checked).
  const { data: routine } = await supabase
    .from("routines")
    .select("id, items, property_id")
    .eq("id", parsed.data.routineId)
    .eq("property_id", parsed.data.propertyId)
    .maybeSingle();
  if (!routine) return { error: "Routine not found" };
  const itemIds = new Set(routine.items.map((i) => i.id));
  if (!itemIds.has(parsed.data.itemId)) return { error: "Unknown item" };

  const { data: existing } = await supabase
    .from("routine_runs")
    .select("id, done_items")
    .eq("routine_id", parsed.data.routineId)
    .eq("run_date", parsed.data.runDate)
    .maybeSingle();

  const current = new Set<string>(
    (existing?.done_items ?? []).filter((i) => itemIds.has(i)),
  );
  if (parsed.data.done) current.add(parsed.data.itemId);
  else current.delete(parsed.data.itemId);
  const doneItems = [...current];
  const completed = doneItems.length === itemIds.size;
  const completedAt = completed ? new Date().toISOString() : null;

  if (existing) {
    const { error } = await supabase
      .from("routine_runs")
      .update({ done_items: doneItems, completed_at: completedAt })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("routine_runs").insert({
      property_id: parsed.data.propertyId,
      routine_id: parsed.data.routineId,
      run_date: parsed.data.runDate,
      done_items: doneItems,
      completed_at: completedAt,
    });
    if (error) return { error: error.message };
  }
  return { ok: true, completed };
}

const SignOffSchema = z.object({
  propertyId: z.string().uuid(),
  spaceId: z.string().uuid(),
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Quick evaluation checkpoint (D2): how did the day go, 1–10? */
  rating: z.number().int().min(1).max(10).optional(),
  ratingNote: z.string().max(500).optional(),
});

/**
 * Evening sign-off — the manager's "has the day been done?" stamp across
 * every one of the team's runs for the date (creating empty run rows for
 * routines nobody opened, so the audit trail shows they were skipped).
 * Owner/manager only.
 */
export async function signOffDay(
  input: z.input<typeof SignOffSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = SignOffSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", parsed.data.propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "manager")
  ) {
    return { error: "Only managers can sign off the day" };
  }

  const weekday = new Date(`${parsed.data.runDate}T12:00:00Z`).getUTCDay();
  const { data: routines } = await supabase
    .from("routines")
    .select("id, days")
    .eq("space_id", parsed.data.spaceId)
    .eq("property_id", parsed.data.propertyId)
    .is("archived_at", null);
  const dueToday = (routines ?? []).filter((r) => r.days.includes(weekday));
  if (dueToday.length === 0) return { error: "Nothing scheduled today" };

  const now = new Date().toISOString();
  for (const r of dueToday) {
    const { error } = await supabase.from("routine_runs").upsert(
      {
        property_id: parsed.data.propertyId,
        routine_id: r.id,
        run_date: parsed.data.runDate,
        signed_off_by: user.id,
        signed_off_at: now,
        rating: parsed.data.rating ?? null,
        rating_note: parsed.data.ratingNote?.trim() || null,
      },
      { onConflict: "routine_id,run_date", ignoreDuplicates: false },
    );
    if (error) return { error: error.message };
  }
  return { ok: true };
}

const FeedbackSchema = z.object({
  propertyId: z.string().uuid(),
  routineId: z.string().uuid(),
  note: z.string().min(1).max(500),
  itemId: z.string().max(80).optional(),
});

/** Staff feedback while doing the work — "this doesn't work well". Feeds the
 *  review nudge managers see (G3). */
export async function flagRoutine(
  input: z.input<typeof FeedbackSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = FeedbackSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("routine_feedback").insert({
    property_id: parsed.data.propertyId,
    routine_id: parsed.data.routineId,
    item_id: parsed.data.itemId ?? null,
    note: parsed.data.note.trim(),
    created_by: user.id,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/** Manager "we relooked at this" — stamps reviewed_at and resolves the open
 *  feedback so the nudge clears. */
export async function markRoutineReviewed(
  routineId: string,
): Promise<{ ok: true } | { error: string }> {
  const id = z.string().uuid().safeParse(routineId);
  if (!id.success) return { error: "Invalid routine" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("routines")
    .update({ reviewed_at: now })
    .eq("id", id.data)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Routine not found" };

  const { error: fbErr } = await supabase
    .from("routine_feedback")
    .update({ resolved_at: now, resolved_by: user.id })
    .eq("routine_id", id.data)
    .is("resolved_at", null);
  if (fbErr) return { error: fbErr.message };
  return { ok: true };
}
