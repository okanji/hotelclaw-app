"use server";

import { z } from "zod";
import { after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { removeUserFromChannels } from "@/lib/stream/server";

const Schema = z.object({
  propertyId: z.string().uuid(),
  userId: z.string().uuid(),
});

/**
 * Remove a member from a property. Owner-only — the same trust level that
 * can't be granted by invite dialogs. Guardrails:
 *  - you can't remove yourself (so a property can never orphan itself;
 *    "leave property" would be a separate, self-serve flow)
 *  - role checks run on the user-scoped client, writes on the service
 *    client (memberships RLS has no delete policy for members)
 *
 * Cleanup: membership row, their spots on this property's team member
 * lists, org-chart reports (their reports' manager_id is nulled), and —
 * after the response — their Stream channel memberships here. Their tasks,
 * messages, and documents stay: history belongs to the property.
 */
export async function removeMember(
  input: z.input<typeof Schema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { propertyId, userId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (user.id === userId) {
    return { error: "You can't remove yourself from a property." };
  }

  const { data: callerMembership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerMembership?.role !== "owner") {
    return { error: "Only the owner can remove people." };
  }

  const service = createServiceClient();

  const { data: target } = await service
    .from("memberships")
    .select("user_id")
    .eq("property_id", propertyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return { error: "They're not a member of this property." };

  const { error: delErr } = await service
    .from("memberships")
    .delete()
    .eq("property_id", propertyId)
    .eq("user_id", userId);
  if (delErr) return { error: delErr.message };

  // Drop them from this property's team member lists.
  const { data: spaces } = await service
    .from("spaces")
    .select("id")
    .eq("property_id", propertyId);
  const spaceIds = (spaces ?? []).map((s) => s.id);
  if (spaceIds.length > 0) {
    await service
      .from("space_members")
      .delete()
      .eq("user_id", userId)
      .in("space_id", spaceIds);
  }

  // Anyone who reported to them here now reports to no one.
  await service
    .from("memberships")
    .update({ manager_id: null })
    .eq("property_id", propertyId)
    .eq("manager_id", userId);

  // Stream cleanup is best-effort and must never block or fail the removal.
  after(async () => {
    try {
      const { data: channels } = await service
        .from("chat_channels")
        .select("stream_channel_id")
        .eq("property_id", propertyId);
      await removeUserFromChannels({
        userId,
        streamChannelIds: (channels ?? []).map((c) => c.stream_channel_id),
      });
    } catch (e) {
      console.error("[members] Stream removal failed", e);
    }
  });

  return { ok: true };
}
