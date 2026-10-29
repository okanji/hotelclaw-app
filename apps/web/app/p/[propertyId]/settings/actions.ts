"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireManagement } from "@/lib/auth/session";

const Details = z.object({
  propertyId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter a property name").max(120),
  timezone: z.string().trim().min(1).max(64),
  taskPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "Task prefix must be 2–5 letters"),
});

/**
 * Settings → Workspace: the property's name, clock and task-key prefix.
 * Owner / manager only — gated here AND by RLS
 * (`properties_update_owner_manager`), which matches zero rows for anyone
 * else.
 */
export async function updatePropertyDetails(
  input: z.input<typeof Details>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = Details.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const { propertyId, name, timezone, taskPrefix } = parsed.data;

  // Reject a zone the runtime can't resolve — cycles compute
  // local dates from it.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { error: "Unknown time zone" };
  }

  const gate = await requireManagement(propertyId);
  if (!gate.ok) return { error: "Only owners and managers can change this" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .update({ name, timezone, task_prefix: taskPrefix })
    .eq("id", propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only owners and managers can change this" };
  }
  revalidatePath(`/p/${propertyId}`, "layout");
  return { ok: true };
}
