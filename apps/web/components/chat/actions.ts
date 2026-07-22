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
  /** Optional: make this a Space's home channel. */
  spaceId?: string | null;
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
    .select("user_id, role")
    .eq("property_id", parsed.data.propertyId);
  if (memErr) return { error: memErr.message };

  const me = (members ?? []).find((m) => m.user_id === user.id);
  const memberIds = (members ?? []).map((m) => m.user_id);
  if (!me) {
    return { error: "Forbidden" };
  }

  // Workspace policy: when channel creation is restricted to management,
  // staff can't create channels (the sidebar hides the affordance too — this
  // is the enforcement).
  const { data: property } = await supabase
    .from("properties")
    .select("channel_creation")
    .eq("id", parsed.data.propertyId)
    .maybeSingle();
  if (
    property?.channel_creation === "management" &&
    me.role !== "owner" &&
    me.role !== "manager"
  ) {
    return { error: "Only managers can create channels in this workspace" };
  }

  const { data: existing, error: existingErr } = await supabase
    .from("chat_channels")
    .select("id")
    .eq("property_id", parsed.data.propertyId)
    .eq("name", parsed.data.name)
    .is("archived_at", null)
    .maybeSingle();
  if (existingErr) return { error: existingErr.message };
  if (existing) {
    return { error: `#${parsed.data.name} already exists` };
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
      space_id: input.spaceId ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    return { error: insErr?.message ?? "DB insert failed" };
  }

  return { channelId: row.id, streamChannelId };
}

/**
 * Set who may create channels in this workspace. RLS
 * (properties_update_owner_manager) already restricts the write to
 * owners/managers — a staff caller's update simply matches zero rows.
 */
export async function setChannelCreationPolicy(input: {
  propertyId: string;
  policy: "everyone" | "management";
}): Promise<{ ok: true } | { error: string }> {
  if (input.policy !== "everyone" && input.policy !== "management") {
    return { error: "Invalid policy" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("properties")
    .update({ channel_creation: input.policy })
    .eq("id", input.propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only owners and managers can change this" };
  }
  return { ok: true };
}
