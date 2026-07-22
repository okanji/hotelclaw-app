import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * D1 — role-based references for workflows. Builds the `org` resolution
 * scope once per run so step configs can point at ROLES instead of people:
 *
 *   {{org.lead.front office}}          → the Front Office team's current lead
 *   {{org.title.maintenance manager}}  → whoever currently holds that title
 *
 * Both resolve to a user id at RUN time — change the person in the org
 * chart and every workflow follows, no edits needed (the "Martin problem").
 * Keys are lowercased; the resolver lowercases the ref path to match.
 */
export type OrgScope = {
  lead: Record<string, string>;
  title: Record<string, string>;
};

export async function buildOrgScope(propertyId: string): Promise<OrgScope> {
  const supabase = createServiceClient();
  const [{ data: spaces }, { data: members }] = await Promise.all([
    supabase
      .from("spaces")
      .select("name, lead_user_id")
      .eq("property_id", propertyId)
      .is("archived_at", null),
    supabase
      .from("memberships")
      .select("user_id, title")
      .eq("property_id", propertyId),
  ]);

  const lead: Record<string, string> = {};
  for (const s of spaces ?? []) {
    if (s.lead_user_id) lead[s.name.toLowerCase()] = s.lead_user_id;
  }
  const title: Record<string, string> = {};
  for (const m of members ?? []) {
    const key = m.title?.trim().toLowerCase();
    // First holder wins on duplicate titles — deterministic, and duplicate
    // titles are an org-chart smell the editor surfaces anyway.
    if (key && !title[key]) title[key] = m.user_id;
  }
  return { lead, title };
}
