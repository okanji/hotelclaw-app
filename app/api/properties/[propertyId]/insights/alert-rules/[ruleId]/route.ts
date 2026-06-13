import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/** PATCH (enable/disable, threshold) / DELETE one of the caller's rules.
 *  RLS pins both operations to the caller's own rows. */

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

const PatchBody = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().int().min(0).max(999).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; ruleId: string }> },
) {
  const { propertyId, ruleId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("insight_alert_rules")
    .update(parsed.data)
    .eq("id", ruleId)
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; ruleId: string }> },
) {
  const { propertyId, ruleId } = await params;
  const auth = await authed(propertyId);
  if ("error" in auth)
    return NextResponse.json({ error: "forbidden" }, { status: auth.error });
  const { error } = await auth.supabase
    .from("insight_alert_rules")
    .delete()
    .eq("id", ruleId)
    .eq("property_id", propertyId)
    .eq("user_id", auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
