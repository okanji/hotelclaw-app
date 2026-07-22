"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getMembershipForProperty } from "@/lib/auth/session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { updatePersonHierarchy, updateTeamHierarchy } from "./actions";

/**
 * D1 — the second path into the org chart: anyone proposes a change
 * ("new head of housekeeping"), an OWNER approves, and the approval applies
 * the change through the same management-gated writers the org editor uses.
 * Direct owner/manager edits remain untouched.
 */

const KINDS = [
  "set_title",
  "set_manager",
  "set_home_team",
  "set_team_lead",
] as const;

const ProposeSchema = z.object({
  propertyId: z.string().uuid(),
  kind: z.enum(KINDS),
  subjectUserId: z.string().uuid().nullable().optional(),
  subjectSpaceId: z.string().uuid().nullable().optional(),
  newText: z.string().trim().max(80).nullable().optional(),
  newId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function proposeOrgChange(
  input: z.input<typeof ProposeSchema>,
): Promise<{ id: string } | { error: string }> {
  const parsed = ProposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const d = parsed.data;

  // Shape check per kind: who/what is being changed, and to what.
  if (d.kind === "set_title" && (!d.subjectUserId || !d.newText)) {
    return { error: "A title change needs a person and the new title" };
  }
  if (d.kind === "set_manager" && (!d.subjectUserId || !d.newId)) {
    return { error: "A manager change needs a person and the new manager" };
  }
  if (d.kind === "set_home_team" && (!d.subjectUserId || !d.newId)) {
    return { error: "A home-team change needs a person and the team" };
  }
  if (d.kind === "set_team_lead" && (!d.subjectSpaceId || !d.newId)) {
    return { error: "A lead change needs the team and the new lead" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const membership = await getMembershipForProperty(d.propertyId);
  if (!membership) return { error: "Not a member of this property" };

  const { data, error } = await supabase
    .from("org_change_proposals")
    .insert({
      property_id: d.propertyId,
      kind: d.kind,
      subject_user_id: d.subjectUserId ?? null,
      subject_space_id: d.subjectSpaceId ?? null,
      new_text: d.newText ?? null,
      new_id: d.newId ?? null,
      note: d.note || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };
  revalidatePath(`/p/${d.propertyId}/home/org`);
  return { id: data.id };
}

const DecideSchema = z.object({
  propertyId: z.string().uuid(),
  proposalId: z.string().uuid(),
  approve: z.boolean(),
});

export async function decideOrgProposal(
  input: z.input<typeof DecideSchema>,
): Promise<{ ok: true } | { error: string }> {
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const membership = await getMembershipForProperty(parsed.data.propertyId);
  if (!membership || membership.role !== "owner") {
    return { error: "Only owners can decide org changes" };
  }

  const { data: proposal } = await supabase
    .from("org_change_proposals")
    .select("*")
    .eq("id", parsed.data.proposalId)
    .eq("property_id", parsed.data.propertyId)
    .maybeSingle();
  if (!proposal) return { error: "Proposal not found" };
  if (proposal.status !== "pending") return { error: "Already decided" };

  // Apply BEFORE stamping the decision, through the same management-gated
  // writers the org editor uses (the caller is an owner, so the gate passes;
  // tenancy re-checks happen inside them).
  if (parsed.data.approve) {
    let applied: { ok: true } | { error: string };
    switch (proposal.kind) {
      case "set_title":
        applied = await updatePersonHierarchy(
          parsed.data.propertyId,
          proposal.subject_user_id!,
          { title: proposal.new_text },
        );
        break;
      case "set_manager":
        applied = await updatePersonHierarchy(
          parsed.data.propertyId,
          proposal.subject_user_id!,
          { managerId: proposal.new_id },
        );
        break;
      case "set_home_team":
        applied = await updatePersonHierarchy(
          parsed.data.propertyId,
          proposal.subject_user_id!,
          { primaryTeamId: proposal.new_id },
        );
        break;
      case "set_team_lead":
        applied = await updateTeamHierarchy(
          parsed.data.propertyId,
          proposal.subject_space_id!,
          { leadUserId: proposal.new_id },
        );
        break;
    }
    if ("error" in applied) return applied;
  }

  // Decision stamp — no member UPDATE policy on the table, so this goes
  // through the service client after the owner check (org-chart pattern).
  const service = createServiceClient();
  const { error } = await service
    .from("org_change_proposals")
    .update({
      status: parsed.data.approve ? "approved" : "rejected",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.proposalId);
  if (error) return { error: error.message };

  revalidatePath(`/p/${parsed.data.propertyId}/home/org`);
  return { ok: true };
}
