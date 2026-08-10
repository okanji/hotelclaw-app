"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { provisionPropertyBrain } from "@/lib/brain/provision";
import { invalidatePropertyBrain } from "@/lib/brain/client";

/**
 * Brain server actions. Provisioning writes property_brains (service-role
 * only), so — like the fleet/org-chart pattern — we role-gate through the
 * caller's own membership first, then let provisionPropertyBrain do the
 * service-client write. Owner-only: minting a brain binding is a
 * property-wide, security-relevant act.
 */

type ActionResult = { ok: true; source: string } | { error: string };
const Uuid = z.string().uuid();

export async function provisionBrainAction(
  propertyId: string,
  { repair = false }: { repair?: boolean } = {},
): Promise<ActionResult> {
  const pid = Uuid.safeParse(propertyId);
  if (!pid.success) return { error: "Invalid property" };

  const membership = await getMembershipForProperty(pid.data);
  if (!membership) return { error: "Not a member of this property" };
  if (membership.role !== "owner") {
    return { error: "Only owners can provision the knowledge brain" };
  }

  const service = createServiceClient();
  const { data: property } = await service
    .from("properties")
    .select("slug")
    .eq("id", pid.data)
    .maybeSingle();
  if (!property?.slug) return { error: "Property not found" };

  // Repair: the row exists but its OAuth client no longer authenticates
  // (revoked server-side, or a partial provisioning run). provisionPropertyBrain
  // refuses to touch an existing row, so drop the dead one first and let it
  // mint a fresh client.
  //
  // NON-DESTRUCTIVE: the source id is deterministic (`prop-<pid[0:8]>`) and
  // `sources_add` tolerates "exists", so the replacement client is rescoped
  // onto the SAME source — every existing page stays exactly where it is.
  if (repair) {
    const { error: delErr } = await service
      .from("property_brains")
      .delete()
      .eq("property_id", pid.data);
    if (delErr) return { error: `Could not clear the old binding: ${delErr.message}` };
  }

  const result = await provisionPropertyBrain(pid.data, property.slug);
  // Always drop the cache — on success the credential changed, and on a
  // repair failure the stale one must not linger either.
  invalidatePropertyBrain(pid.data);
  if ("error" in result) return { error: result.error };
  if ("skipped" in result) {
    // Already provisioned / pod-inherited is a benign no-op from the UI —
    // surface it as success so the view just refreshes to the real state.
    revalidatePath(`/p/${pid.data}/agents/brain`);
    return result.skipped.includes("already") || result.skipped.includes("pod")
      ? { ok: true, source: "" }
      : { error: result.skipped };
  }

  revalidatePath(`/p/${pid.data}/agents/brain`);
  return { ok: true, source: result.source };
}
