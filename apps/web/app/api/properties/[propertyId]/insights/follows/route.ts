import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { parseScope } from "@/lib/insights/scope";

/**
 * The caller's lens follows for this property (email digests).
 *   GET    → list
 *   PUT    {scope, cadence} → upsert
 *   DELETE {scope} → unfollow
 * Owner/manager only — staff have no Insights page to follow. RLS enforces
 * own-row access; routes go through the user client so it applies.
 */

async function authed(propertyId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 as const };
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role === "staff") return { error: 403 as const };
  return { supabase, user };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { data, error } = await auth.supabase
    .from("insight_follows")
    .select("id, scope, cadence")
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ follows: data ?? [] });
}

const PutBody = z.object({
  scope: z.string(),
  cadence: z.enum(["daily", "weekly"]),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = PutBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parseScope(parsed.data.scope)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { error } = await auth.supabase.from("insight_follows").upsert(
    {
      user_id: auth.user.id,
      property_id: propertyId,
      scope: parsed.data.scope,
      cadence: parsed.data.cadence,
    },
    { onConflict: "user_id,property_id,scope" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const DeleteBody = z.object({ scope: z.string() });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = DeleteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("insight_follows")
    .delete()
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id)
    .eq("scope", parsed.data.scope);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
