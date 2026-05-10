import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/db/types";

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
    .select("property_id, role, property:properties!inner(id, name, slug)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getUserMemberships error", error);
    return [];
  }
  return (data ?? []) as unknown as Membership[];
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
