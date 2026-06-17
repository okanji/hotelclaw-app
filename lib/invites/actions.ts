"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  addUserToPublicChannels,
  upsertStreamUser,
} from "@/lib/stream/server";
import { sendInviteEmail } from "@/lib/email/send-invite-email";
import { getOrigin } from "@/lib/utils/origin";
import { createNotification } from "@/lib/notifications/server";
import type { Role } from "@/lib/db/types";

const Roles = ["owner", "manager", "staff"] as const;

const CreateSchema = z.object({
  propertyId: z.string().uuid(),
  email: z.string().email().max(254),
  role: z.enum(Roles).default("staff"),
});


/**
 * Why we use the admin API (and not signInWithOtp):
 *
 * `auth.signInWithOtp` initiates a PKCE flow — it stores a code-verifier
 * cookie in the SAME browser that called it. When the recipient opens the
 * email link in a *different* browser, exchangeCodeForSession fails with
 * "PKCE code verifier not found." This burned us in production.
 *
 * `auth.admin.inviteUserByEmail` (new users) and `auth.admin.generateLink`
 * (existing users) skip PKCE entirely. They produce token_hash-based links
 * that work cross-browser. Both require service role, which is fine here
 * because we already gate the action by membership role.
 *
 * Dedup: re-inviting the same email to the same property reuses the
 * pending-invite token (refreshing expiry + role) instead of creating a
 * second row. Slack does this — the recipient sees one entry.
 */
export async function createInvite(
  input: z.input<typeof CreateSchema>,
): Promise<
  | {
      token: string;
      url: string;
      emailSent: boolean;
      isExistingUser: boolean;
      isResend: boolean;
      emailError?: string;
    }
  | { error: string }
> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", parsed.data.propertyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "manager")
  ) {
    return { error: "You don't have permission to invite to this property." };
  }

  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const email = parsed.data.email.toLowerCase();
  const service = createServiceClient();

  // Look for an existing pending (unaccepted) invite for this email+property.
  const { data: existingInvite } = await service
    .from("invites")
    .select("token")
    .eq("property_id", parsed.data.propertyId)
    .eq("email", email)
    .is("accepted_at", null)
    .maybeSingle();

  let token: string;
  let isResend = false;
  if (existingInvite) {
    token = existingInvite.token;
    isResend = true;
    const { error: updateErr } = await service
      .from("invites")
      .update({ expires_at: expiresAt, role: parsed.data.role })
      .eq("token", token);
    if (updateErr) return { error: updateErr.message };
  } else {
    token = crypto.randomUUID();
    const { error: insertError } = await service.from("invites").insert({
      property_id: parsed.data.propertyId,
      email,
      role: parsed.data.role,
      token,
      expires_at: expiresAt,
      created_by: user.id,
    });
    if (insertError) return { error: insertError.message };
  }

  const origin = await getOrigin();
  const inviteAcceptUrl = `${origin}/invites/${token}`;

  // Pull inviter + property name for the email body.
  const [{ data: inviterProfile }, { data: property }] = await Promise.all([
    service.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    service
      .from("properties")
      .select("name")
      .eq("id", parsed.data.propertyId)
      .maybeSingle(),
  ]);
  const inviterName = inviterProfile?.full_name ?? user.email ?? "A teammate";
  const propertyName = property?.name ?? "a workspace";

  // Try invite-new-user first. Returns specific error if user exists.
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: inviteAcceptUrl },
  );

  if (!inviteError) {
    return {
      token,
      url: inviteAcceptUrl,
      emailSent: true,
      isExistingUser: false,
      isResend,
    };
  }

  const errMsg = inviteError.message ?? "";
  const userExists =
    /already (been )?registered|already exists|email_exists/i.test(errMsg);

  if (!userExists) {
    return {
      token,
      url: inviteAcceptUrl,
      emailSent: false,
      isExistingUser: false,
      isResend,
      emailError: errMsg,
    };
  }

  // Existing user — generate a magic link, then ship it via Resend.
  const { data: linkData, error: linkError } =
    await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: inviteAcceptUrl },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return {
      token,
      url: inviteAcceptUrl,
      emailSent: false,
      isExistingUser: true,
      isResend,
      emailError: linkError?.message ?? "Failed to generate magic link",
    };
  }

  const magicUrl = linkData.properties.action_link;

  // Block re-inviting someone who already belongs to this property. We can
  // only resolve email → membership for existing accounts (memberships key on
  // user_id, and profiles don't store email), which is exactly this branch —
  // a brand-new account can't be a member yet. If they're already in, drop the
  // pending-invite row we created above (it'd be a no-op) and report it back.
  if (linkData.user?.id) {
    const { data: alreadyMember } = await service
      .from("memberships")
      .select("user_id")
      .eq("property_id", parsed.data.propertyId)
      .eq("user_id", linkData.user.id)
      .maybeSingle();
    if (alreadyMember) {
      if (!isResend) {
        await service
          .from("invites")
          .delete()
          .eq("property_id", parsed.data.propertyId)
          .eq("email", email)
          .is("accepted_at", null);
      }
      return { error: `${email} is already a member of this property.` };
    }
  }

  // Existing user — also drop an in-app notification so they see it as soon
  // as they next visit the app, even if the email lands in spam.
  if (linkData.user?.id) {
    await createNotification({
      userId: linkData.user.id,
      propertyId: parsed.data.propertyId,
      type: "invite_received",
      payload: {
        inviteToken: token,
        propertyName,
        role: parsed.data.role,
      },
    });
  }

  const sendResult = await sendInviteEmail({
    to: email,
    inviterName,
    propertyName,
    role: parsed.data.role,
    acceptUrl: magicUrl,
    inviteToken: token,
  });

  return {
    token,
    url: magicUrl,
    emailSent: sendResult.ok,
    isExistingUser: true,
    isResend,
    emailError: sendResult.error,
  };
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
  if (!user)
    return { error: "Sign in to accept this invite.", needsAuth: true };

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
      .eq("is_private", false)
      .is("archived_at", null);

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
