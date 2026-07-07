"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type ActionError = { error: string };
const Uuid = z.string().uuid();

/**
 * Space membership. `space_members` is an organizational roster (who works in
 * F&B, Maintenance…), not a security boundary — RLS still gates by property
 * membership through the parent space. The picker maps these user ids against
 * the already-loaded property members for names/avatars.
 */

export async function addSpaceMember(
  spaceId: string,
  userId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const uid = Uuid.safeParse(userId);
  if (!sid.success || !uid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("space_members")
    .insert({ space_id: sid.data, user_id: uid.data });
  if (error) {
    if (error.code === "23505") return { ok: true }; // already a member
    return { error: error.message };
  }
  return { ok: true };
}

export async function removeSpaceMember(
  spaceId: string,
  userId: string,
): Promise<{ ok: true } | ActionError> {
  const sid = Uuid.safeParse(spaceId);
  const uid = Uuid.safeParse(userId);
  if (!sid.success || !uid.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("space_members")
    .delete()
    .eq("space_id", sid.data)
    .eq("user_id", uid.data);
  if (error) return { error: error.message };
  return { ok: true };
}
