import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/db/types";
import { canManage, isFullMember } from "@/lib/auth/roles";

export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export type Membership = {
  property_id: string;
  role: Role;
  property: { id: string; name: string; slug: string };
};

export async function getUserMemberships(): Promise<Membership[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return [];

  // Important: filter by user_id explicitly. Membership RLS lets you read
  // EVERY membership row for properties you belong to (so the members panel
  // can show all teammates), which means an unfiltered query returns the
  // sibling memberships too — and the property switcher then renders the
  // same property multiple times (one row per teammate). Always filter to
  // self when listing the current user's properties.
  const { data, error } = await supabase
    .from("memberships")
    .select(
      "property_id, role, property:properties!inner(id, name, slug, archived_at)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getUserMemberships error", error);
    return [];
  }

  // Drop archived properties — e.g. one whose sole owner deleted their
  // account. Remaining members keep their membership row but the property
  // should no longer surface in the switcher.
  const rows = (data ?? []) as unknown as (Membership & {
    property: { archived_at: string | null };
  })[];
  return rows.filter((m) => !m.property.archived_at);
}

export async function getMembershipForProperty(propertyId: string) {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;
  const { data } = await supabase
    .from("memberships")
    .select("property_id, role")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data;
}

export type MembershipGate =
  | { ok: true; role: Role; userId: string }
  | { ok: false; error: string; status: 401 | 403 };

/**
 * The server-side role gates every service-client route and action must
 * pass before it touches data on a property's behalf. RLS alone no longer
 * suffices once guests exist (0118): a guest's membership row opens the
 * property, but a service-client write bypasses RLS entirely, so the gate
 * has to be explicit. `lib/security/__tests__/guest-gates.test.ts` keeps a
 * baseline of routes that still lack one.
 */
export async function requireFullMember(
  propertyId: string,
): Promise<MembershipGate> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Unauthorized", status: 401 };
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || !isFullMember(membership.role)) {
    return { ok: false, error: "Not a member of this property", status: 403 };
  }
  return { ok: true, role: membership.role, userId: user.id };
}

/** Owners + managers only (members, invites, org chart, status sets, guest grants). */
export async function requireManagement(
  propertyId: string,
): Promise<MembershipGate> {
  const gate = await requireFullMember(propertyId);
  if (!gate.ok) return gate;
  if (!canManage(gate.role)) {
    return { ok: false, error: "Only owners and managers can do this", status: 403 };
  }
  return gate;
}
