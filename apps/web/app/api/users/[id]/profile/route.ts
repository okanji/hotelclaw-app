import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Returns a richer view of one user (name, avatar, email, joined-at) for the
 * profile side panel. RLS on `profiles` already restricts the SELECT to users
 * sharing a property; we use the same client to enforce that. Email lives on
 * `auth.users`, so we only reach it via the service client AFTER confirming
 * the requesting user is allowed to see the profile.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!profile) {
    // Either the user doesn't exist or the requester doesn't share a property
    // with them — RLS hides both behind the same response.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let email: string | null = null;
  try {
    const service = createServiceClient();
    const { data } = await service.auth.admin.getUserById(id);
    email = data.user?.email ?? null;
  } catch {
    // Surfacing the email is best-effort.
  }

  return NextResponse.json({
    id: profile.id,
    name: profile.full_name,
    avatarUrl: profile.avatar_url,
    email,
    joinedAt: profile.created_at,
    isSelf: profile.id === user.id,
  });
}
