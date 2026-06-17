import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Invites SENT for a property — both still-pending and past (accepted or
 * expired). Powers the "Invites" management modal in the property switcher.
 *
 * Distinct from /api/me/pending-invites, which lists invites addressed TO the
 * current user. This is the inviter's view: everyone they've invited here.
 *
 * Gated to owner/manager (the same roles that can create invites). We verify
 * the caller's role with the user-scoped client, then read via the service
 * client so we can also resolve created_by → inviter name without tripping the
 * memberships→auth.users FK that breaks PostgREST relational joins.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "manager")
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("invites")
    .select("token, email, role, created_at, expires_at, accepted_at, created_by")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    token: string;
    email: string;
    role: string;
    created_at: string;
    expires_at: string;
    accepted_at: string | null;
    created_by: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Resolve inviter names in one batch.
  const inviterIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  const namesById = new Map<string, string | null>();
  if (inviterIds.length > 0) {
    const { data: profiles } = await service
      .from("profiles")
      .select("id, full_name")
      .in("id", inviterIds as string[]);
    for (const p of profiles ?? []) namesById.set(p.id, p.full_name);
  }

  const now = Date.now();
  const items = rows.map((r) => {
    const status: "pending" | "accepted" | "expired" = r.accepted_at
      ? "accepted"
      : new Date(r.expires_at).getTime() < now
        ? "expired"
        : "pending";
    return {
      token: r.token,
      email: r.email,
      role: r.role,
      status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      acceptedAt: r.accepted_at,
      invitedByName: r.created_by ? (namesById.get(r.created_by) ?? null) : null,
    };
  });

  return NextResponse.json({
    pending: items.filter((i) => i.status === "pending"),
    past: items.filter((i) => i.status !== "pending"),
  });
}
