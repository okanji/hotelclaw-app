"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { deleteStreamUser } from "@/lib/stream/server";
import { deletePropertyRooms } from "@/lib/liveblocks/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Permanently delete the signed-in user's account.
 *
 * Per property the user belongs to:
 *  - sole owner            -> the property is archived (archived_at stamped)
 *                             and its Liveblocks rooms are deleted; remaining
 *                             members keep their rows but the property drops
 *                             out of their switcher.
 *  - co-owner / manager /
 *    staff                 -> nothing extra — the membership row is removed
 *                             by the auth.users cascade below.
 *
 * Deleting the auth user cascades to profiles, memberships and notifications
 * (all FK'd to auth.users with ON DELETE CASCADE — see migrations 0001/0004).
 *
 * External services (Stream Chat, Liveblocks) are cleaned up best-effort —
 * a failure there must not block the actual deletion in Supabase, which is
 * the source of truth.
 *
 * On success this redirects to /login and never returns; it only returns when
 * something failed, so the caller can surface the error.
 */
export async function deleteAccount(): Promise<{ error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Membership writes (delete) and auth.admin both need the service role —
  // memberships has no delete RLS policy and the GoTrue admin API is
  // service-role only.
  const admin = createServiceClient();

  // Archive every property this user is the *sole* owner of.
  const { data: owned, error: ownedErr } = await admin
    .from("memberships")
    .select("property_id")
    .eq("user_id", user.id)
    .eq("role", "owner");
  if (ownedErr) return { error: ownedErr.message };

  for (const { property_id } of owned ?? []) {
    const { count, error: countErr } = await admin
      .from("memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("property_id", property_id)
      .eq("role", "owner")
      .neq("user_id", user.id);
    if (countErr) return { error: countErr.message };
    // A co-owner remains — the property lives on under them; just leaving
    // (the cascade) is enough.
    if ((count ?? 0) > 0) continue;

    const { error: archiveErr } = await admin
      .from("properties")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", property_id);
    if (archiveErr) return { error: archiveErr.message };

    // The property is being torn down — delete its Liveblocks rooms
    // (board, task and document rooms). Best-effort.
    try {
      await deletePropertyRooms(property_id);
    } catch (e) {
      console.error(`deletePropertyRooms failed for ${property_id}`, e);
    }
  }

  // Hard-delete the user's Stream Chat identity (user + messages + DMs).
  try {
    await deleteStreamUser(user.id);
  } catch (e) {
    console.error("deleteStreamUser failed", e);
  }

  // Drop the user's avatar files — storage objects aren't FK-cascaded, so an
  // orphaned folder would otherwise linger.
  try {
    const { data: files } = await admin.storage.from("avatars").list(user.id);
    if (files && files.length > 0) {
      await admin.storage
        .from("avatars")
        .remove(files.map((f) => `${user.id}/${f.name}`));
    }
  } catch (e) {
    console.error("avatar cleanup failed", e);
  }

  // Hard-delete the auth user. Cascades: profiles, memberships, notifications.
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return { error: delErr.message };

  await supabase.auth.signOut();
  redirect("/login");
}
