"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  addUserToPublicChannels,
  upsertStreamUser,
} from "@/lib/stream/server";
import type { Role } from "@/lib/db/types";

const Roles = ["owner", "manager", "staff"] as const;

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  email: z.string().email().max(254),
  role: z.enum(Roles).default("staff"),
});

export async function createInvite(
  input: z.input<typeof CreateSchema>,
): Promise<{ token: string; url: string } | { error: string }> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Only owners/managers can invite. Check via the user-scoped client (RLS
  // policy on `invites_insert_owner_manager` enforces it server-side too).
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", parsed.data.propertyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || (membership.role !== "owner" && membership.role !== "manager")) {
    return { error: "You don't have permission to invite to this property." };
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase.from("invites").insert({
    property_id: parsed.data.propertyId,
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
    token,
    expires_at: expiresAt,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  // Build absolute URL on the server using NEXT_PUBLIC_SITE_URL or fall back
  // to a relative path the client will absolutize.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const url = `${origin}/invites/${token}`;
  return { token, url };
}

export async function acceptInvite(
  token: string,
): Promise<
  | { propertyId: string; propertyName: string }
  | { error: string; needsAuth?: true }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to accept this invite.", needsAuth: true };

  const service = createServiceClient();

  const { data: invite, error: fetchErr } = await service
    .from("invites")
    .select("property_id, role, expires_at, accepted_at, email")
    .eq("token", token)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!invite) return { error: "Invite not found." };
  if (invite.accepted_at) return { error: "This invite has already been used." };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: "This invite has expired." };
  }

  // If user is already a member, just mark accepted and send them in.
  const { data: existing } = await service
    .from("memberships")
    .select("role")
    .eq("property_id", invite.property_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    const { error: memErr } = await service.from("memberships").insert({
      property_id: invite.property_id,
      user_id: user.id,
      role: invite.role as Role,
    });
    if (memErr) return { error: memErr.message };

    // Bring them into Stream and into all public team channels of this
    // property — Slack-style "joining a workspace adds you to public channels."
    // Private channels still require explicit invitation via the channel itself.
    const { data: profile } = await service
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    await upsertStreamUser({
      id: user.id,
      name: profile?.full_name ?? user.email ?? user.id,
      image: profile?.avatar_url ?? null,
    });

    const { data: publicChannels } = await service
      .from("chat_channels")
      .select("stream_channel_id")
      .eq("property_id", invite.property_id)
      .eq("is_private", false);

    if (publicChannels && publicChannels.length > 0) {
      await addUserToPublicChannels({
        propertyId: invite.property_id,
        userId: user.id,
        streamChannelIds: publicChannels.map((c) => c.stream_channel_id),
      });
    }
  }

  await service
    .from("invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token", token);

  const { data: property } = await service
    .from("properties")
    .select("name")
    .eq("id", invite.property_id)
    .maybeSingle();

  return {
    propertyId: invite.property_id,
    propertyName: property?.name ?? "Property",
  };
}
