import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EntityColor } from "@/lib/db/types";

/**
 * The company hierarchy ("org chart"). Built on the existing `spaces` table
 * (product name: Teams) + `memberships`, extended by migration 0071 with the
 * hierarchy columns:
 *
 *   spaces.parent_space_id   team → parent team (F&B → Restaurant, Bar)
 *   spaces.lead_user_id      who runs the team
 *   memberships.title        job title at this property
 *   memberships.manager_id   reports-to (a user, within the property)
 *   memberships.primary_space_id  home team (task creation defaults to it)
 *
 * This is deterministic data consumed by two surfaces: the /home/org editor
 * and the AI layer (`renderOrgChart` → the `get_org_chart` tool text). Loaded
 * with whatever client the caller passes (RLS server client for the app,
 * service client for bots).
 */

export type OrgTeam = {
  id: string;
  name: string;
  /** What the team does — the routing signal for AI (who owns this work). */
  description: string | null;
  icon: string | null;
  color: EntityColor;
  parentId: string | null;
  leadUserId: string | null;
  position: number;
  memberIds: string[];
};

export type OrgPerson = {
  id: string;
  name: string | null;
  /** Login email (from auth.users). Populated only by callers with a service
   *  client (see the org API route); null for the RLS-scoped/bot path. */
  email: string | null;
  avatarUrl: string | null;
  role: string; // membership role: owner | manager | staff
  title: string | null;
  managerId: string | null;
  primaryTeamId: string | null;
};

export type OrgChart = {
  teams: OrgTeam[];
  people: OrgPerson[];
};

type DB = SupabaseClient<Database>;

export async function loadOrgChart(
  supabase: DB,
  propertyId: string,
): Promise<OrgChart> {
  const [teamsRes, membersRes, rosterRes] = await Promise.all([
    supabase
      .from("spaces")
      .select(
        "id, name, description, icon, color, position, parent_space_id, lead_user_id",
      )
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("memberships")
      .select("user_id, role, title, manager_id, primary_space_id")
      .eq("property_id", propertyId),
    supabase
      .from("space_members")
      .select("space_id, user_id, spaces!inner(property_id)")
      .eq("spaces.property_id", propertyId),
  ]);

  const teamsRaw = teamsRes.data ?? [];
  const membersRaw = membersRes.data ?? [];
  const rosterRaw = rosterRes.data ?? [];

  // Profiles for the member names (FK goes to auth.users, so no relational
  // join — the same two-query pattern the members route uses).
  const userIds = membersRaw.map((m) => m.user_id as string);
  const profilesRes = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; avatar_url: string | null }[] };
  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p] as const),
  );

  const rosterByTeam = new Map<string, string[]>();
  for (const r of rosterRaw) {
    const list = rosterByTeam.get(r.space_id as string) ?? [];
    list.push(r.user_id as string);
    rosterByTeam.set(r.space_id as string, list);
  }

  const teams: OrgTeam[] = teamsRaw.map((t) => ({
    id: t.id as string,
    name: t.name as string,
    description: (t.description as string | null) ?? null,
    icon: (t.icon as string | null) ?? null,
    color: (t.color as EntityColor) ?? "slate",
    parentId: (t.parent_space_id as string | null) ?? null,
    leadUserId: (t.lead_user_id as string | null) ?? null,
    position: (t.position as number) ?? 0,
    memberIds: rosterByTeam.get(t.id as string) ?? [],
  }));

  const people: OrgPerson[] = membersRaw.map((m) => {
    const p = profileById.get(m.user_id as string);
    return {
      id: m.user_id as string,
      name: p?.full_name ?? null,
      email: null,
      avatarUrl: p?.avatar_url ?? null,
      role: (m.role as string) ?? "staff",
      title: (m.title as string | null) ?? null,
      managerId: (m.manager_id as string | null) ?? null,
      primaryTeamId: (m.primary_space_id as string | null) ?? null,
    };
  });

  return { teams, people };
}
