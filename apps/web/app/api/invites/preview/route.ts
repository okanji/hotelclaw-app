import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Public-by-email lookup of pending invites. Used on the signup form to
 * preview "you've been invited to X workspace" before the user creates
 * their account.
 *
 * Privacy note: anyone can probe whether an email has pending invites and
 * which workspaces. Same exposure surface as the invite-link itself
 * (which the inviter freely shares); not worse than Slack's similar
 * preview. If we ever care more, gate behind a CAPTCHA or rate limit.
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !isLikelyEmail(email)) {
    return NextResponse.json([]);
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("invites")
    .select(
      "token, role, expires_at, property:properties!inner(id, name)",
    )
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    token: string;
    role: string;
    expires_at: string;
    property: { id: string; name: string };
  };

  const items = ((data ?? []) as unknown as Row[]).map((row) => ({
    token: row.token,
    role: row.role,
    propertyName: row.property.name,
  }));

  return NextResponse.json(items);
}

function isLikelyEmail(s: string): boolean {
  // Cheap pre-filter — DB-side validation isn't necessary, we just want to
  // skip pointless queries while the user is still typing.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
