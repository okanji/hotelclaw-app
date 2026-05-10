"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";

const Roles = ["owner", "manager"] as const;

async function requireChannelAdmin(propertyId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !membership ||
    !(Roles as readonly string[]).includes(membership.role)
  ) {
    return { ok: false, error: "You don't have permission for this." };
  }
  return { ok: true, userId: user.id };
}

const RenameSchema = z.object({
  propertyId: z.string().uuid(),
  streamChannelId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "letters, numbers, and dashes only"),
});

export async function renameChannel(
  input: z.input<typeof RenameSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const gate = await requireChannelAdmin(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };

  const newName = parsed.data.name.toLowerCase();
  const stream = getStreamServer();
  try {
    const channel = stream.channel("team", parsed.data.streamChannelId);
    await channel.update({ name: newName } as Record<string, unknown>);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stream update failed" };
  }

  // Mirror to our Postgres row so other queries (search, AI agents) see the
  // new name without hitting Stream.
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_channels")
    .update({ name: newName })
    .eq("property_id", parsed.data.propertyId)
    .eq("stream_channel_id", parsed.data.streamChannelId);
  if (error) return { error: error.message };

  revalidatePath(`/p/${parsed.data.propertyId}/chat`);
  return { ok: true };
}

const DeleteSchema = z.object({
  propertyId: z.string().uuid(),
  streamChannelId: z.string().min(1),
});

export async function deleteChannel(
  input: z.input<typeof DeleteSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const gate = await requireChannelAdmin(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };

  const stream = getStreamServer();
  try {
    const channel = stream.channel("team", parsed.data.streamChannelId);
    await channel.delete();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stream delete failed" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_channels")
    .delete()
    .eq("property_id", parsed.data.propertyId)
    .eq("stream_channel_id", parsed.data.streamChannelId);
  if (error) return { error: error.message };

  revalidatePath(`/p/${parsed.data.propertyId}/chat`);
  return { ok: true };
}
