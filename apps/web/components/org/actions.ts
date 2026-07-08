"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import type { Database } from "@/lib/db/types";

type TeamUpdate = Database["public"]["Tables"]["spaces"]["Update"];
type MembershipUpdate = Database["public"]["Tables"]["memberships"]["Update"];

/**
 * Org-chart edits — the company hierarchy. Restructuring who runs what and who
 * reports to whom is management-only (owners + managers); staff can view the
 * chart but not rewrite it.
 *
 * `memberships` has no RLS UPDATE policy (role/membership writes are
 * deliberately service-role only, to keep role escalation off the client), so
 * these mutations run through the SERVICE client after an explicit management
 * gate — `requireManagement` reads the caller's OWN membership via the RLS
 * client to verify their role, then the service client performs the scoped
 * write. We only ever touch the hierarchy columns, never `role`.
 */

type ActionError = { error: string };
const Uuid = z.string().uuid();
const NullableUuid = z.string().uuid().nullable();

async function requireManagement(
  propertyId: string,
): Promise<{ ok: true } | ActionError> {
  const pid = Uuid.safeParse(propertyId);
  if (!pid.success) return { error: "Invalid property" };
  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };
  if (membership.role !== "owner" && membership.role !== "manager") {
    return { error: "Only owners and managers can edit the org chart" };
  }
  return { ok: true };
}

const TeamName = z.string().trim().min(1).max(60);

/**
 * Create a team (space) directly from the org chart, optionally under a parent
 * — the "+ add team" placeholders in the diagram. Management-only. Colors
 * cycle through the entity palette so new teams get a distinct dot.
 */
export async function createTeam(
  propertyId: string,
  name: string,
  parentId: string | null,
): Promise<{ id: string } | ActionError> {
  const gate = await requireManagement(propertyId);
  if ("error" in gate) return gate;

  const parsedName = TeamName.safeParse(name);
  if (!parsedName.success) return { error: "Team name is required" };

  let parent: string | null = null;
  if (parentId) {
    const p = Uuid.safeParse(parentId);
    if (!p.success) return { error: "Invalid parent team" };
    parent = p.data;
  }

  const supabase = createServiceClient();

  const { data: last } = await supabase
    .from("spaces")
    .select("position")
    .eq("property_id", propertyId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (last?.position ?? 0) + 1024;

  const PALETTE = ["slate", "blue", "green", "amber", "rose", "violet"] as const;
  const { count } = await supabase
    .from("spaces")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  const color = PALETTE[(count ?? 0) % PALETTE.length];

  const { data, error } = await supabase
    .from("spaces")
    .insert({
      property_id: propertyId,
      name: parsedName.data,
      position,
      color,
      parent_space_id: parent,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "Could not create team" };
  }

  revalidatePath(`/p/${propertyId}/home/org`);
  return { id: data.id };
}

/** Set a team's parent (null = top level) and/or lead. Guards against a team
 *  becoming its own ancestor (which would break the tree render + AI walk). */
export async function updateTeamHierarchy(
  propertyId: string,
  teamId: string,
  patch: { parentId?: string | null; leadUserId?: string | null },
): Promise<{ ok: true } | ActionError> {
  const gate = await requireManagement(propertyId);
  if ("error" in gate) return gate;

  const tid = Uuid.safeParse(teamId);
  if (!tid.success) return { error: "Invalid team" };

  const update: TeamUpdate = {};

  if ("parentId" in patch) {
    const parsed = NullableUuid.safeParse(patch.parentId);
    if (!parsed.success) return { error: "Invalid parent team" };
    if (parsed.data === tid.data) {
      return { error: "A team can't report to itself" };
    }
    if (parsed.data && (await createsCycle(tid.data, parsed.data))) {
      return { error: "That would create a loop in the team hierarchy" };
    }
    update.parent_space_id = parsed.data;
  }

  if ("leadUserId" in patch) {
    const parsed = NullableUuid.safeParse(patch.leadUserId);
    if (!parsed.success) return { error: "Invalid lead" };
    update.lead_user_id = parsed.data;
  }

  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("spaces")
    .update(update)
    .eq("id", tid.data)
    .eq("property_id", propertyId);
  if (error) return { error: error.message };

  // Assigning a lead IS assigning a management role: if the new lead has no
  // job title yet, name it "Head of {Team}" so the chart (and every bot
  // reading it) states the role. Never overwrites a title someone set.
  if (update.lead_user_id) {
    const { data: team } = await supabase
      .from("spaces")
      .select("name")
      .eq("id", tid.data)
      .maybeSingle();
    if (team?.name) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("title")
        .eq("property_id", propertyId)
        .eq("user_id", update.lead_user_id)
        .maybeSingle();
      if (membership && !membership.title) {
        await supabase
          .from("memberships")
          .update({ title: `Head of ${team.name}` })
          .eq("property_id", propertyId)
          .eq("user_id", update.lead_user_id);
      }
    }
  }

  revalidatePath(`/p/${propertyId}/home/org`);
  return { ok: true };
}

/** Set a person's title, manager (reports-to), and/or primary (home) team. */
export async function updatePersonHierarchy(
  propertyId: string,
  userId: string,
  patch: {
    title?: string | null;
    managerId?: string | null;
    primaryTeamId?: string | null;
  },
): Promise<{ ok: true } | ActionError> {
  const gate = await requireManagement(propertyId);
  if ("error" in gate) return gate;

  const uid = Uuid.safeParse(userId);
  if (!uid.success) return { error: "Invalid person" };

  const update: MembershipUpdate = {};

  if ("title" in patch) {
    const t = (patch.title ?? "").trim();
    update.title = t.length ? t.slice(0, 80) : null;
  }
  if ("managerId" in patch) {
    const parsed = NullableUuid.safeParse(patch.managerId);
    if (!parsed.success) return { error: "Invalid manager" };
    if (parsed.data === uid.data) {
      return { error: "Someone can't report to themselves" };
    }
    update.manager_id = parsed.data;
  }
  if ("primaryTeamId" in patch) {
    const parsed = NullableUuid.safeParse(patch.primaryTeamId);
    if (!parsed.success) return { error: "Invalid team" };
    update.primary_space_id = parsed.data;
  }

  if (Object.keys(update).length === 0) return { ok: true };

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("memberships")
    .update(update)
    .eq("user_id", uid.data)
    .eq("property_id", propertyId);
  if (error) return { error: error.message };

  revalidatePath(`/p/${propertyId}/home/org`);
  return { ok: true };
}

/** Walk up from `candidateParent`; if we reach `teamId`, the link loops. */
async function createsCycle(
  teamId: string,
  candidateParent: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  let cursor: string | null = candidateParent;
  for (let i = 0; i < 32 && cursor; i++) {
    if (cursor === teamId) return true;
    const { data }: { data: { parent_space_id: string | null } | null } =
      await supabase
        .from("spaces")
        .select("parent_space_id")
        .eq("id", cursor)
        .maybeSingle();
    cursor = data?.parent_space_id ?? null;
  }
  return false;
}
