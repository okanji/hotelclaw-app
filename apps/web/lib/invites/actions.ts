"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
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
  // Optional pre-fill: the inviter (or onboarding wizard) can position the
  // person up front. Applied to their profile/membership on accept; the
  // invited-user onboarding form pre-fills from these and stays editable.
  fullName: z.string().trim().max(120).optional(),
  title: z.string().trim().max(80).optional(),
  primarySpaceId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
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

  // Pre-fill columns, normalized: empty strings → null so they don't overwrite
  // real values on accept.
  const prefill = {
    full_name: parsed.data.fullName?.trim() || null,
    title: parsed.data.title?.trim() || null,
    primary_space_id: parsed.data.primarySpaceId ?? null,
    manager_id: parsed.data.managerId ?? null,
  };

  let token: string;
  let isResend = false;
  if (existingInvite) {
    token = existingInvite.token;
    isResend = true;
    const { error: updateErr } = await service
      .from("invites")
      .update({
        expires_at: expiresAt,
        role: parsed.data.role,
        ...prefill,
      })
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
      ...prefill,
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

/**
 * Withdraw a still-pending invite. Owner/manager only. Deletes the row so the
 * token stops resolving and the recipient's in-app pending entry disappears.
 * No-op-safe: already-accepted invites are left untouched.
 */
export async function revokeInvite(input: {
  propertyId: string;
  token: string;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z
    .object({ propertyId: z.string().uuid(), token: z.string().min(1) })
    .safeParse(input);
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
    return { error: "You don't have permission to manage invites here." };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("invites")
    .delete()
    .eq("property_id", parsed.data.propertyId)
    .eq("token", parsed.data.token)
    .is("accepted_at", null);

  if (error) return { error: error.message };
  return { ok: true };
}

export async function acceptInvite(
  token: string,
  // Edits the invited user made in the acceptance onboarding form. When
  // omitted (e.g. a plain "Accept" click), the invite's pre-fill values apply
  // as-is. `manager_id` is inviter-only, never user-editable.
  overrides?: { fullName?: string; title?: string; primarySpaceId?: string },
): Promise<
  | { propertyId: string; propertyName: string }
  | { error: string; needsAuth?: true; wrongAccount?: true }
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
    .select(
      "property_id, role, expires_at, accepted_at, email, full_name, title, primary_space_id, manager_id",
    )
    .eq("token", token)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!invite) return { error: "Invite not found." };
  if (invite.accepted_at) return { error: "This invite has already been used." };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: "This invite has expired." };
  }

  // The invite is bound to the invited address — the token alone isn't enough.
  // Enforced here (not just in the page UI) because the link is a bearer URL
  // anyone could paste into a different signed-in browser. This once let a
  // look-alike account accept a real person's owner invite.
  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return {
      error: user.email
        ? `This invite was sent to ${invite.email}, but you're signed in as ${user.email}. Sign in with ${invite.email} to accept it.`
        : `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
      wrongAccount: true,
    };
  }

  const { data: existing } = await service
    .from("memberships")
    .select("role")
    .eq("property_id", invite.property_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    // Resolve position/team/reports-to: the user's edits win, else the
    // inviter's pre-fill, else null.
    const resolvedTitle =
      (overrides?.title ?? invite.title ?? "").trim().slice(0, 80) || null;
    const resolvedSpaceId =
      overrides?.primarySpaceId ?? invite.primary_space_id ?? null;
    const resolvedManagerId = invite.manager_id ?? null;

    const { error: memErr } = await service.from("memberships").insert({
      property_id: invite.property_id,
      user_id: user.id,
      role: invite.role as Role,
      title: resolvedTitle,
      primary_space_id: resolvedSpaceId,
      manager_id: resolvedManagerId,
    });
    if (memErr) return { error: memErr.message };

    // Add them to their home team's member list (best-effort; a duplicate is
    // harmless if they were somehow pre-added).
    if (resolvedSpaceId) {
      await service
        .from("space_members")
        .insert({ space_id: resolvedSpaceId, user_id: user.id });
    }

    const { data: profile } = await service
      .from("profiles")
      .select("full_name, avatar_url, onboarded_at")
      .eq("id", user.id)
      .maybeSingle();

    // Seed their display name from the acceptance form / invite pre-fill, but
    // only when they don't already have one (never clobber a real name).
    const resolvedName = (overrides?.fullName ?? invite.full_name ?? "").trim();
    let effectiveName = profile?.full_name ?? null;
    if (!effectiveName && resolvedName) {
      await service
        .from("profiles")
        .update({
          full_name: resolvedName,
          onboarded_at: profile?.onboarded_at ?? new Date().toISOString(),
        })
        .eq("id", user.id);
      effectiveName = resolvedName;
    }

    await upsertStreamUser({
      id: user.id,
      name: effectiveName ?? user.email ?? user.id,
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

/**
 * "Wrong account" escape hatch on the invite page: sign the current session
 * out and bounce to login with the invite as the post-auth destination, so
 * the recipient can come back with the address the invite was sent to.
 */
export async function switchAccountForInvite(token: string): Promise<never> {
  const parsed = z.string().min(1).max(255).safeParse(token);
  const next = parsed.success
    ? `/login?next=${encodeURIComponent(`/invites/${parsed.data}`)}`
    : "/login";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(next);
}
