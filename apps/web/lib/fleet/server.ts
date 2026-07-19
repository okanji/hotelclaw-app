import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Shared loader for the fleet pages: the property's pod (client row), the
 * property slug (brain playbook paths), and the caller's role. Null client
 * ⇒ the property belongs to no pod and every /agents/fleet/* page 404s.
 * All reads via the caller's RLS client (is_client_member SELECT policies).
 */
export async function loadFleetScope(propertyId: string): Promise<{
  client: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "paused" | "offboarded";
    brain_source: string;
    brain_client_secret_ref: string;
  } | null;
  propertySlug: string | null;
  role: string | null;
}> {
  const supabase = await createClient();
  const membership = await getMembershipForProperty(propertyId);
  const { data: property } = await supabase
    .from("properties")
    .select("slug, client_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property?.client_id) {
    return { client: null, propertySlug: property?.slug ?? null, role: membership?.role ?? null };
  }
  const { data: client } = await supabase
    .from("clients")
    .select("id, slug, name, status, brain_source, brain_client_secret_ref")
    .eq("id", property.client_id)
    .maybeSingle();
  return {
    client: client ?? null,
    propertySlug: property.slug,
    role: membership?.role ?? null,
  };
}
