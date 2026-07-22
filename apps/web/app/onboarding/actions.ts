"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  createPropertyChannel,
  getStreamServer,
  upsertStreamUser,
} from "@/lib/stream/server";
import { createInvite } from "@/lib/invites/actions";
import { provisionPropertyBrain } from "@/lib/brain/provision";
import { startGuestChatbotBuild } from "@/lib/onboarding/chatbot-workflow";
import {
  seedStarterAutomation,
  seedDefaultAlertRules,
} from "@/lib/onboarding/automations";
import {
  AnswersSchema,
  PlanSchema,
  deterministicPlan,
  sanitizePlan,
  planFormToFormSchema,
  starterBookingServices,
  type OnboardingAnswers,
  type OnboardingAnswersInput,
  type OnboardingPlan,
} from "@/lib/onboarding/plan";

const Schema = z.object({
  name: z.string().min(1).max(120),
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Bootstrap property + owner membership. Onboarding inserts run via the
 * service client: the user just authenticated and is bootstrapping their
 * own workspace. RLS still protects every other path; this is the one
 * elevated entry point. Rolls the property back if the membership insert
 * fails so the user can retry.
 */
async function bootstrapProperty(
  name: string,
  userId: string,
): Promise<{ propertyId: string; brainWarning?: string } | { error: string }> {
  const baseSlug = slugify(name) || "property";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  const service = createServiceClient();

  const { data: property, error: propErr } = await service
    .from("properties")
    .insert({ name, slug })
    .select("id")
    .single();
  if (propErr || !property) {
    return { error: propErr?.message ?? "Failed to create property" };
  }

  const { error: memErr } = await service.from("memberships").insert({
    property_id: property.id,
    user_id: userId,
    role: "owner",
  });
  if (memErr) {
    // Roll back the orphaned property so the user can retry.
    await service.from("properties").delete().eq("id", property.id);
    return { error: memErr.message };
  }

  // Bind the property to the shared knowledge brain. Fail-soft: a failure
  // leaves the property brainless (the provisioning sweep reconciles), and
  // on hosts without the gbrain CLI this is an instant no-op.
  const brain = await provisionPropertyBrain(property.id, slug);

  return {
    propertyId: property.id,
    brainWarning: "error" in brain ? brain.error : undefined,
  };
}

/** Kept for compatibility — the bare "name only" property creation. */
export async function createProperty(input: {
  name: string;
}): Promise<{ propertyId: string } | { error: string }> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  return bootstrapProperty(parsed.data.name, user.id);
}

/**
 * createWorkspace — the wizard's seeding action.
 *
 * Creates the property + owner membership (the only fatal stage), then
 * seeds everything the plan describes: profile row, spaces + memberships,
 * #general and department/extra channels (Stream + chat_channels mirror),
 * a welcome message, starter labels, one published form, and invites.
 *
 * Every post-bootstrap stage is fail-soft: a Stream hiccup or a single
 * bad insert logs + lands in `warnings` instead of stranding the user on
 * the build screen. Inserts after the bootstrap use the *user* client —
 * the owner membership exists, so RLS passes; only the property/membership
 * bootstrap is service-elevated.
 */
export async function createWorkspace(input: {
  answers: OnboardingAnswersInput;
  plan: unknown;
}): Promise<{ propertyId: string; warnings: string[] } | { error: string }> {
  const parsedAnswers = AnswersSchema.safeParse(input.answers);
  if (!parsedAnswers.success) return { error: "Invalid answers" };
  const answers: OnboardingAnswers = parsedAnswers.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Never trust the client blob — re-validate, and re-derive the plan
  // deterministically when it's missing or malformed.
  const parsedPlan = PlanSchema.safeParse(input.plan);
  const plan: OnboardingPlan = parsedPlan.success
    ? sanitizePlan(parsedPlan.data)
    : deterministicPlan(answers);

  // ── Fatal stage: property + owner membership ─────────────────────────────
  const bootstrap = await bootstrapProperty(answers.propertyName, user.id);
  if ("error" in bootstrap) return bootstrap;
  const propertyId = bootstrap.propertyId;

  const warnings: string[] = [];
  const warn = (stage: string, e: unknown) => {
    console.error(`[createWorkspace] ${stage} failed`, e);
    warnings.push(stage);
  };
  if (bootstrap.brainWarning) warn("brain provisioning", bootstrap.brainWarning);

  // ── Stream user (before any channel creation) ────────────────────────────
  const service = createServiceClient();
  try {
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
  } catch (e) {
    warn("stream user", e);
  }

  // ── Property profile ─────────────────────────────────────────────────────
  try {
    const { error } = await supabase.from("property_profiles").insert({
      property_id: propertyId,
      property_type: answers.propertyType,
      team_size: answers.teamSize,
      departments: answers.departments.map((d) => d.name),
      priorities: answers.priorities,
      role_title: answers.roleTitle || null,
      answers: {
        propertyName: answers.propertyName,
        propertyType: answers.propertyType,
        teamSize: answers.teamSize,
        departments: answers.departments,
        roleTitle: answers.roleTitle,
        priorities: answers.priorities,
        operations: answers.operations,
        guestContact: answers.guestContact,
        notes: answers.notes,
        inviteCount: answers.invites.length,
      },
    });
    if (error) throw error;
  } catch (e) {
    warn("property profile", e);
  }

  // ── Spaces + creator memberships ─────────────────────────────────────────
  const spaceIdBySlug = new Map<string, string>();
  try {
    if (plan.spaces.length > 0) {
      const { data: rows, error } = await supabase
        .from("spaces")
        .insert(
          plan.spaces.map((s, i) => ({
            property_id: propertyId,
            name: s.name,
            icon: s.icon,
            color: s.color,
            position: i * 1024,
            created_by: user.id,
            // Owner leads every team on day one so the org chart is populated
            // immediately; reassign real leads later in the org editor.
            lead_user_id: user.id,
          })),
        )
        .select("id, name");
      if (error || !rows) throw error ?? new Error("no rows");

      // Map back by name (insert preserves nothing else we can key on).
      for (const s of plan.spaces) {
        const row = rows.find((r) => r.name === s.name);
        if (row) spaceIdBySlug.set(s.channelSlug, row.id);
      }

      const { error: memErr } = await supabase
        .from("space_members")
        .insert(rows.map((r) => ({ space_id: r.id, user_id: user.id })));
      if (memErr) throw memErr;

      // Owner's home team = the first team (their tasks default here until they
      // set it in the org editor). memberships has no RLS update policy, so
      // this goes through the service client.
      if (rows[0]) {
        await service
          .from("memberships")
          .update({ primary_space_id: rows[0].id })
          .eq("property_id", propertyId)
          .eq("user_id", user.id);
      }
    }
  } catch (e) {
    warn("spaces", e);
  }

  // ── Owner's job title on their membership (org chart) ────────────────────
  if (plan.orgTitle) {
    try {
      const { error } = await service
        .from("memberships")
        .update({ title: plan.orgTitle })
        .eq("property_id", propertyId)
        .eq("user_id", user.id);
      if (error) throw error;
    } catch (e) {
      warn("owner title", e);
    }
  }

  // ── Channels: #general first, then department + extra channels ──────────
  type ChannelSpec = { slug: string; spaceId: string | null };
  const channelSpecs: ChannelSpec[] = [
    { slug: "general", spaceId: null },
    ...plan.spaces.map((s) => ({
      slug: s.channelSlug,
      spaceId: spaceIdBySlug.get(s.channelSlug) ?? null,
    })),
    ...plan.extraChannels
      .filter((c) => c.slug !== "general")
      .map((c) => ({ slug: c.slug, spaceId: null })),
  ];
  // sanitizePlan dedupes within the plan; this guards general overlap too.
  const seen = new Set<string>();

  let generalStreamId: string | null = null;
  for (const spec of channelSpecs) {
    if (seen.has(spec.slug)) continue;
    seen.add(spec.slug);
    try {
      const streamChannelId = `prop-${propertyId.slice(0, 8)}-${spec.slug}-${crypto
        .randomUUID()
        .slice(0, 6)}`;
      await createPropertyChannel({
        propertyId,
        channelId: streamChannelId,
        name: spec.slug,
        createdBy: user.id,
        memberIds: [user.id],
        isPrivate: false,
      });
      const { error } = await supabase.from("chat_channels").insert({
        property_id: propertyId,
        stream_channel_id: streamChannelId,
        stream_channel_type: "team",
        name: spec.slug,
        is_private: false,
        space_id: spec.spaceId,
        created_by: user.id,
      });
      if (error) throw error;
      if (spec.slug === "general") generalStreamId = streamChannelId;
    } catch (e) {
      warn(`channel #${spec.slug}`, e);
    }
  }

  // ── Welcome message in #general, posted as the creator ──────────────────
  if (generalStreamId && plan.welcomeMessage) {
    try {
      const channel = getStreamServer().channel("team", generalStreamId);
      await channel.sendMessage({
        text: plan.welcomeMessage,
        user_id: user.id,
      } as unknown as Parameters<typeof channel.sendMessage>[0]);
    } catch (e) {
      warn("welcome message", e);
    }
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  try {
    if (plan.labels.length > 0) {
      const { error } = await supabase.from("labels").insert(
        plan.labels.map((l) => ({
          property_id: propertyId,
          name: l.name,
          color: l.color,
          created_by: user.id,
        })),
      );
      if (error) throw error;
    }
  } catch (e) {
    warn("labels", e);
  }

  // ── Forms (published, ready to share) ────────────────────────────────────
  // Ids captured so the starter automation can bind to the maintenance form.
  let insertedForms: { id: string; title: string }[] = [];
  if (plan.forms.length > 0) {
    try {
      const { data: formRows, error } = await supabase
        .from("forms")
        .insert(
          plan.forms.map((f) => ({
            property_id: propertyId,
            title: f.title,
            description: f.description || null,
            icon: f.icon ?? "📋",
            schema: planFormToFormSchema(f.fields) as unknown as Record<
              string,
              unknown
            >,
            status: "published" as const,
            created_by: user.id,
          })),
        )
        .select("id, title");
      if (error) throw error;
      insertedForms = formRows ?? [];
    } catch (e) {
      warn("forms", e);
    }
  }

  // ── Starter SOP docs (titled stubs, ready to fill in) ────────────────────
  if (plan.docs.length > 0) {
    try {
      const { error } = await supabase.from("documents").insert(
        plan.docs.map((d, i) => ({
          property_id: propertyId,
          title: d.title,
          kind: "doc" as const,
          icon: d.icon ?? "📄",
          position: i * 1024,
          created_by: user.id,
        })),
      );
      if (error) throw error;
    } catch (e) {
      warn("docs", e);
    }
  }

  // ── Bookable services (capacity-mode, from what they operate) ────────────
  const bookingServices = starterBookingServices(answers.operations);
  if (bookingServices.length > 0) {
    try {
      const { error } = await supabase.from("bookable_services").insert(
        bookingServices.map((svc) => ({
          property_id: propertyId,
          name: svc.name,
          kind: svc.kind,
          booking_mode: svc.bookingMode,
          emoji: svc.emoji,
          description: svc.description,
          schedule: svc.schedule,
          active: true,
          // Staff refine hours/timezone and flip this on when ready to go live.
          public_bookable: false,
          created_by: user.id,
        })),
      );
      if (error) throw error;
    } catch (e) {
      warn("bookable services", e);
    }
  }

  // ── Guest chatbot (durable workflow — AI draft with template fallback) ──
  // Fire-and-forget: the workflow runs beyond this request; the draft bot
  // appears under Chatbots shortly after the user lands in the workspace.
  try {
    const opsList = answers.operations.length
      ? answers.operations.join(", ")
      : "general hospitality";
    const contactList = answers.guestContact.length
      ? answers.guestContact.join(", ")
      : "in person";
    await startGuestChatbotBuild({
      propertyId,
      ownerId: user.id,
      propertyName: answers.propertyName,
      description: [
        `A guest-facing chatbot for ${answers.propertyName}, a ${answers.propertyType.replace(/-/g, " ")} (${answers.teamSize} staff).`,
        `On-site operations: ${opsList}.`,
        `Guests typically reach the property via: ${contactList}.`,
        `The bot should answer common guest questions, take simple requests, and hand off to staff when needed.`,
        answers.notes ? `How the property runs day-to-day: ${answers.notes}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch (e) {
    warn("guest chatbot", e);
  }

  // ── Starter automation: maintenance form → task ──────────────────────────
  const maintenanceForm = insertedForms.find((f) => /maintenance/i.test(f.title));
  if (maintenanceForm) {
    try {
      // Route the task to the maintenance/engineering team when one exists.
      const maintenanceSpace = plan.spaces.find((s) =>
        /mainten|engineer/i.test(s.name),
      );
      await seedStarterAutomation({
        propertyId,
        userId: user.id,
        formId: maintenanceForm.id,
        formTitle: maintenanceForm.title,
        spaceId: maintenanceSpace
          ? (spaceIdBySlug.get(maintenanceSpace.channelSlug) ?? null)
          : null,
      });
    } catch (e) {
      warn("starter automation", e);
    }
  }

  // ── Default insight alert rules for the owner ────────────────────────────
  try {
    await seedDefaultAlertRules({ propertyId, userId: user.id });
  } catch (e) {
    warn("alert rules", e);
  }

  // ── Invites (best-effort, per row) ───────────────────────────────────────
  // A department picked in the wizard becomes the invitee's home team via
  // the invite-prefill columns (0072) — they land already positioned.
  const spaceIdByDeptName = new Map<string, string>();
  for (const s of plan.spaces) {
    const id = spaceIdBySlug.get(s.channelSlug);
    if (id) spaceIdByDeptName.set(s.name.toLowerCase(), id);
  }
  for (const invite of answers.invites) {
    try {
      const result = await createInvite({
        propertyId,
        email: invite.email,
        role: invite.role,
        fullName: invite.name,
        title: invite.title,
        primarySpaceId: invite.department
          ? spaceIdByDeptName.get(invite.department.toLowerCase())
          : undefined,
      });
      if ("error" in result) {
        warn(`invite ${invite.email}`, result.error);
      }
    } catch (e) {
      warn(`invite ${invite.email}`, e);
    }
  }

  return { propertyId, warnings };
}
