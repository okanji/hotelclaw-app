"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Persist the signed-in user's list-view column layout (migration 0099).
 * Ordinary member data behind RLS — the policy pins `user_id` to the caller
 * and requires property membership, so no extra tenancy check is needed here.
 *
 * Deliberately NOT `revalidatePath`: the tasks board is fully client-rendered
 * and the caller already holds the new layout optimistically. Re-rendering the
 * server tree on every column drag would fight the drag.
 */

const ColumnZ = z.object({
  id: z.string().min(1).max(80),
  width: z.number().int().min(60).max(800),
  hidden: z.boolean().optional(),
  // Footer calculation id (lib/tasks/list-columns.ts). Free-form here —
  // resolveColumns drops unknown ids, so an old client can't wedge a save.
  calc: z.string().min(1).max(30).optional(),
});

const SaveLayoutSchema = z.object({
  propertyId: z.string().uuid(),
  viewKey: z.string().min(1).max(60).default("tasks:list"),
  columns: z.array(ColumnZ).max(40),
  sort: z
    .object({
      columnId: z.string().min(1).max(80),
      dir: z.enum(["asc", "desc"]),
    })
    .nullable()
    .default(null),
});

export async function saveTaskViewLayout(
  input: z.input<typeof SaveLayoutSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = SaveLayoutSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid layout" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("task_view_columns").upsert(
    {
      user_id: user.id,
      property_id: parsed.data.propertyId,
      view_key: parsed.data.viewKey,
      columns: parsed.data.columns,
      sort: parsed.data.sort,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,property_id,view_key" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
