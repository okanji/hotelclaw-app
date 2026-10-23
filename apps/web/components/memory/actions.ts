"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { propertyScope } from "@hotelclaw/memory";
import { getMembershipForProperty, getSessionUser } from "@/lib/auth/session";
import { memoryStore } from "@/lib/memory/store";

/**
 * Memory curation actions. agent_memories has NO member write policies, so
 * — like the fleet/org-chart pattern — we role-gate through the caller's
 * own membership, then write with the service-backed store. Owners and
 * managers curate; staff read.
 */

type ActionResult = { ok: true } | { error: string };
const Uuid = z.string().uuid();

type Gate = { propertyId: string; userId: string | null } | { error: string };

async function curator(propertyId: string): Promise<Gate> {
  const pid = Uuid.safeParse(propertyId);
  if (!pid.success) return { error: "Invalid property" };
  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };
  if (membership.role !== "owner" && membership.role !== "manager") {
    return { error: "Only owners and managers curate memory" };
  }
  const user = await getSessionUser();
  return { propertyId: pid.data, userId: user?.id ?? null };
}

/** Find the row by id anywhere in the property (the browser spans subject kinds). */
async function rowScope(propertyId: string, memoryId: string) {
  const rows = await memoryStore().listProperty(propertyId, { limit: 300 });
  const row = rows.find((r) => r.id === memoryId);
  if (!row) return null;
  return { propertyId: row.property_id, subjectKind: row.subject_kind, subjectId: row.subject_id };
}

export async function rememberMemoryAction(
  propertyId: string,
  input: { content: string; kind?: "fact" | "preference" | "event" | "outcome" | "playbook"; pinned?: boolean; source?: string },
): Promise<ActionResult> {
  const gate = await curator(propertyId);
  if ("error" in gate) return { error: gate.error };
  const parsed = z
    .object({
      content: z.string().trim().min(8).max(2000),
      kind: z.enum(["fact", "preference", "event", "outcome", "playbook"]).default("fact"),
      pinned: z.boolean().default(false),
      source: z.string().trim().max(200).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Write one specific fact (8–2000 characters)." };
  try {
    await memoryStore().remember({
      scope: propertyScope(gate.propertyId),
      content: parsed.data.content,
      kind: parsed.data.kind,
      pinned: parsed.data.pinned,
      source: parsed.data.source || `added in the Memory browser`,
      createdBy: gate.userId,
      createdVia: "member",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath(`/p/${gate.propertyId}/agents/memory`);
  return { ok: true };
}

export async function forgetMemoryAction(
  propertyId: string,
  memoryId: string,
): Promise<ActionResult> {
  const gate = await curator(propertyId);
  if ("error" in gate) return { error: gate.error };
  if (!Uuid.safeParse(memoryId).success) return { error: "Invalid memory" };
  const scope = await rowScope(gate.propertyId, memoryId);
  if (!scope) return { error: "Memory not found" };
  const ok = await memoryStore().forget(scope, memoryId);
  if (!ok) return { error: "Memory not found" };
  revalidatePath(`/p/${gate.propertyId}/agents/memory`);
  return { ok: true };
}

export async function pinMemoryAction(
  propertyId: string,
  memoryId: string,
  pinned: boolean,
): Promise<ActionResult> {
  const gate = await curator(propertyId);
  if ("error" in gate) return { error: gate.error };
  if (!Uuid.safeParse(memoryId).success) return { error: "Invalid memory" };
  const scope = await rowScope(gate.propertyId, memoryId);
  if (!scope) return { error: "Memory not found" };
  const ok = await memoryStore().setPinned(scope, memoryId, pinned);
  if (!ok) return { error: "Memory not found" };
  revalidatePath(`/p/${gate.propertyId}/agents/memory`);
  return { ok: true };
}
