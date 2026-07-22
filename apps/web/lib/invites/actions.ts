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
import {
  createNotification,
  createNotifications,
  findAlreadyNotifiedUserIds,
} from "@/lib/notifications/server";
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
 * `auth.admin.generateLink` skips PKCE entirely and gives us a
 * `hashed_token` we embed in OUR /auth/confirm URL (never the raw
 * `action_link` — Supabase's /verify returns the session in the URL
 * fragment, which the server-rendered invite page can't see; recipients
 * stayed on the wrong session and got bounced to a login wall). Type
 * "invite" also CREATES the account without sending Supabase's own email,
 * so one Resend email covers both new and existing recipients. Requires
 * service role, which is fine here because we already gate the action by
 * membership role.
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

  // Both paths use `generateLink` and ship ONE Resend email built on the
  // app's own /auth/confirm token_hash route. We deliberately do NOT email
  // the raw `action_link`: Supabase's /verify hands the session back in the
  // URL *fragment*, which a server-rendered page never sees — the recipient
  // stayed on their old session (or none), hit the wrong-account warning,
  // and got signed out into a login wall. token_hash → /auth/confirm sets
  // the session in cookies server-side and works cross-browser.
  //
  // `type: "invite"` creates the account without sending Supabase's own
  // email; existing accounts error with email_exists → retry as magiclink.
  let linkType: "invite" | "magiclink" = "invite";
  let linkRes = await service.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo: inviteAcceptUrl },
  });

  if (
    linkRes.error &&
    /already (been )?registered|already exists|email_exists/i.test(
      linkRes.error.message ?? "",
    )
  ) {
    linkType = "magiclink";
    linkRes = await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: inviteAcceptUrl },
    });
  }

  const isExistingUser = linkType === "magiclink";
  const { data: linkData, error: linkError } = linkRes;

  if (linkError || !linkData?.properties?.hashed_token) {
    return {
      token,
      url: inviteAcceptUrl,
      emailSent: false,
      isExistingUser,
      isResend,
      emailError: linkError?.message ?? "Failed to generate sign-in link",
    };
  }

  // If this one-time sign-in link is stale by the time it's clicked,
  // /auth/confirm forwards `next` to /login, so the recipient still lands
  // back on the invite after signing in manually.
  const magicUrl = `${origin}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=${linkType}&next=${encodeURIComponent(`/invites/${token}`)}`;

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

  // Also drop an in-app notification so they see it as soon as they next
  // visit the app, even if the email lands in spam.
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
    isExistingUser,
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

/**
 * Fix the role on a still-pending invite. Owner/manager only — the same gate
 * as creating one.
 *
 * Exists because the role is decided in one dialog and only visible in
 * another: an invite sent with the wrong role used to be unfixable without
 * revoking and re-sending (which mails the recipient a second time). The
 * invite's role is only read at accept time, so editing it in place is safe
 * right up until it's used.
 */
export async function updateInviteRole(input: {
  propertyId: string;
  token: string;
  role: Role;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = z
    .object({
      propertyId: z.string().uuid(),
      token: z.string().min(1),
      role: z.enum(Roles),
    })
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
  const { data: updated, error } = await service
    .from("invites")
    .update({ role: parsed.data.role })
    .eq("property_id", parsed.data.propertyId)
    .eq("token", parsed.data.token)
    .is("accepted_at", null)
    .select("token")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!updated) {
    return { error: "That invite has already been accepted or revoked." };
  }
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

/**
 * The other half of the "wrong account" escape hatch — for the (common) case
 * where the recipient can't sign in as the invited address at all, because
 * the inviter typed a stale or misspelled one.
 *
 * Signing out doesn't help them; the only path was to chase the inviter down
 * out of band, so people simply gave up here. This pings the inviter in-app
 * with the address the person actually uses, so they can retarget the invite.
 *
 * Deliberately conservative: it only fires from a genuine mismatch on a live
 * invite, it reveals nothing about the invite to the caller beyond what the
 * page already showed them, and it's deduped per (invite, requester) for 24h
 * so a frustrated click-click-click doesn't spam the inviter.
 */
export async function requestInviteAccess(
  token: string,
): Promise<{ ok: true; notified: boolean } | { error: string }> {
  const parsed = z.string().min(1).max(255).safeParse(token);
  if (!parsed.success) return { error: "Invalid invite" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Sign in first." };

  const service = createServiceClient();
  const { data: invite } = await service
    .from("invites")
    .select("property_id, email, expires_at, accepted_at, created_by")
    .eq("token", parsed.data)
    .maybeSingle();

  if (!invite) return { error: "Invite not found." };
  if (invite.accepted_at) return { error: "This invite has already been used." };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: "This invite has expired. Ask for a fresh one." };
  }
  // Only a real mismatch may ask — the matching case has an Accept button.
  if (user.email.toLowerCase() === invite.email.toLowerCase()) {
    return { error: "You can accept this invite directly." };
  }

  // Notify the inviter, falling back to the property's owners if they've
  // since left (or the row predates created_by).
  let recipients: string[] = invite.created_by ? [invite.created_by] : [];
  if (recipients.length === 0) {
    const { data: owners } = await service
      .from("memberships")
      .select("user_id")
      .eq("property_id", invite.property_id)
      .eq("role", "owner");
    recipients = (owners ?? []).map((o) => o.user_id as string);
  }
  if (recipients.length === 0) return { ok: true, notified: false };

  const alreadyNotified = await findAlreadyNotifiedUserIds({
    userIds: recipients,
    type: "invite_access_requested",
    match: { key: "requestedBy", value: user.id },
  });
  const fresh = recipients.filter((id) => !alreadyNotified.has(id));
  if (fresh.length === 0) return { ok: true, notified: true };

  const { data: property } = await service
    .from("properties")
    .select("name")
    .eq("id", invite.property_id)
    .maybeSingle();
  const { data: profile } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  await createNotifications(
    fresh.map((userId) => ({
      userId,
      propertyId: invite.property_id,
      type: "invite_access_requested" as const,
      payload: {
        requestedBy: user.id,
        requesterName: profile?.full_name ?? null,
        requesterEmail: user.email!,
        invitedEmail: invite.email,
        propertyName: property?.name ?? "your property",
      },
    })),
  );

  return { ok: true, notified: true };
}
