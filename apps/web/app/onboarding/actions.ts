"use server";

import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  createPropertyChannel,
  getStreamServer,
  upsertStreamUser,
} from "@/lib/stream/server";
import { createInvite } from "@/lib/invites/actions";
import {
  AnswersSchema,
  PlanSchema,
  deterministicPlan,
  sanitizePlan,
  planFormToFormSchema,
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
): Promise<{ propertyId: string } | { error: string }> {
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

  return { propertyId: property.id };
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
    }
  } catch (e) {
    warn("spaces", e);
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

  // ── Starter form (published, ready to share) ─────────────────────────────
  if (plan.starterForm) {
    try {
      const { error } = await supabase.from("forms").insert({
        property_id: propertyId,
        title: plan.starterForm.title,
        description: plan.starterForm.description || null,
        icon: "📋",
        schema: planFormToFormSchema(plan.starterForm.fields) as unknown as Record<
          string,
          unknown
        >,
        status: "published",
        created_by: user.id,
      });
      if (error) throw error;
    } catch (e) {
      warn("starter form", e);
    }
  }

  // ── Invites (best-effort, per row) ───────────────────────────────────────
  for (const invite of answers.invites) {
    try {
      const result = await createInvite({
        propertyId,
        email: invite.email,
        role: invite.role,
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
