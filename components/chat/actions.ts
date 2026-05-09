"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPropertyChannel } from "@/lib/stream/server";

const Schema = z.object({
  propertyId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/i, "letters, numbers, and dashes only"),
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createChannel(input: {
  propertyId: string;
  name: string;
}): Promise<{ channelId: string; streamChannelId: string } | { error: string }> {
  const parsed = Schema.safeParse({
    propertyId: input.propertyId,
    name: slugify(input.name),
  });
  if (!parsed.success) {
    return { error: "Invalid channel name" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: members, error: memErr } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("property_id", parsed.data.propertyId);
  if (memErr) return { error: memErr.message };

  const memberIds = (members ?? []).map((m) => m.user_id);
  if (!memberIds.includes(user.id)) {
    return { error: "Forbidden" };
  }

  const streamChannelId = `prop-${parsed.data.propertyId.slice(0, 8)}-${parsed.data.name}-${crypto
    .randomUUID()
    .slice(0, 6)}`;

  try {
    await createPropertyChannel({
      propertyId: parsed.data.propertyId,
      channelId: streamChannelId,
      name: parsed.data.name,
      createdBy: user.id,
      memberIds,
      isPrivate: false,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stream error" };
  }

  const { data: row, error: insErr } = await supabase
    .from("chat_channels")
    .insert({
      property_id: parsed.data.propertyId,
      stream_channel_id: streamChannelId,
      stream_channel_type: "team",
      name: parsed.data.name,
      is_private: false,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    return { error: insErr?.message ?? "DB insert failed" };
  }

  return { channelId: row.id, streamChannelId };
}
