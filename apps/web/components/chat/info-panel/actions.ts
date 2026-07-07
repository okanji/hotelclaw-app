"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";

export type ArchivedChannel = {
  streamChannelId: string;
  name: string;
  archivedAt: string;
};

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
  // Soft-archive: freeze the Stream channel so no new messages can be posted,
  // and stamp archived_at on our row. Message history is preserved and the
  // name becomes available for a new channel (partial unique index in 0005).
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const gate = await requireChannelAdmin(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };

  const stream = getStreamServer();
  try {
    const channel = stream.channel("team", parsed.data.streamChannelId);
    await channel.updatePartial({ set: { frozen: true } });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stream freeze failed" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_channels")
    .update({ archived_at: new Date().toISOString() })
    .eq("property_id", parsed.data.propertyId)
    .eq("stream_channel_id", parsed.data.streamChannelId);
  if (error) return { error: error.message };

  revalidatePath(`/p/${parsed.data.propertyId}/chat`);
  return { ok: true };
}

const ListArchivedSchema = z.object({
  propertyId: z.string().uuid(),
});

export async function listArchivedChannels(
  input: z.input<typeof ListArchivedSchema>,
): Promise<{ channels: ArchivedChannel[] } | { error: string }> {
  const parsed = ListArchivedSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const gate = await requireChannelAdmin(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_channels")
    .select("stream_channel_id, name, archived_at")
    .eq("property_id", parsed.data.propertyId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  if (error) return { error: error.message };

  return {
    channels: (data ?? []).map((row) => ({
      streamChannelId: row.stream_channel_id,
      name: row.name,
      archivedAt: row.archived_at as string,
    })),
  };
}

const RestoreSchema = z.object({
  propertyId: z.string().uuid(),
  streamChannelId: z.string().min(1),
});

export async function restoreChannel(
  input: z.input<typeof RestoreSchema>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const parsed = RestoreSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const gate = await requireChannelAdmin(parsed.data.propertyId);
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: row, error: rowErr } = await supabase
    .from("chat_channels")
    .select("id, name, archived_at")
    .eq("property_id", parsed.data.propertyId)
    .eq("stream_channel_id", parsed.data.streamChannelId)
    .maybeSingle();
  if (rowErr) return { error: rowErr.message };
  if (!row || !row.archived_at) return { error: "Channel is not archived" };

  // Collision: an active channel already owns this name. Suffix the restored
  // row with the first 4 chars of its uuid — the partial unique index then
  // accepts both. The user can rename via channel settings afterward.
  const { data: collision } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("property_id", parsed.data.propertyId)
    .eq("name", row.name)
    .is("archived_at", null)
    .maybeSingle();

  const finalName = collision ? `${row.name}-${row.id.slice(0, 4)}` : row.name;

  const stream = getStreamServer();
  try {
    const channel = stream.channel("team", parsed.data.streamChannelId);
    await channel.updatePartial({
      set: { frozen: false, name: finalName } as Record<string, unknown>,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stream restore failed" };
  }

  const { error: updErr } = await supabase
    .from("chat_channels")
    .update({ archived_at: null, name: finalName })
    .eq("property_id", parsed.data.propertyId)
    .eq("stream_channel_id", parsed.data.streamChannelId);
  if (updErr) {
    // Re-freeze so DB and Stream stay in sync after the failed write.
    try {
      const channel = stream.channel("team", parsed.data.streamChannelId);
      await channel.updatePartial({ set: { frozen: true } });
    } catch {
      // Best-effort rollback; surface the original DB error.
    }
    return { error: updErr.message };
  }

  revalidatePath(`/p/${parsed.data.propertyId}/chat`);
  return { ok: true, name: finalName };
}
