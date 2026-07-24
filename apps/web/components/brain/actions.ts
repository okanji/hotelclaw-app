"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { provisionPropertyBrain } from "@/lib/brain/provision";

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

  const result = await provisionPropertyBrain(pid.data, property.slug);
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
