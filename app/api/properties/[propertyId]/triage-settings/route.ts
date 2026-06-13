import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * The property's triage autonomy dial.
 *   GET   → auto-apply flags + per-field acceptance stats (members)
 *   PATCH → flip a field's auto-apply (owner only — graduating the bot is a
 *           property-level trust decision)
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createServiceClient();
  const [{ data: settings }, { data: resolved }] = await Promise.all([
    service
      .from("triage_settings")
      .select("auto_apply")
      .eq("property_id", propertyId)
      .maybeSingle(),
    service
      .from("task_suggestions")
      .select("field, status")
      .eq("property_id", propertyId)
      .in("status", ["accepted", "dismissed", "auto_applied"]),
  ]);

  const stats: Record<string, { accepted: number; dismissed: number; autoApplied: number }> =
    {};
  for (const row of resolved ?? []) {
    const s = (stats[row.field] ??= { accepted: 0, dismissed: 0, autoApplied: 0 });
    if (row.status === "accepted") s.accepted += 1;
    else if (row.status === "dismissed") s.dismissed += 1;
    else s.autoApplied += 1;
  }

  return NextResponse.json({
    autoApply: settings?.auto_apply ?? {},
    stats,
    canEdit: membership.role === "owner",
  });
}

const Body = z.object({
  field: z.enum(["space", "assignee", "priority"]),
  enabled: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: existing } = await service
    .from("triage_settings")
    .select("auto_apply")
    .eq("property_id", propertyId)
    .maybeSingle();
  const autoApply = {
    ...((existing?.auto_apply ?? {}) as Record<string, boolean>),
    [parsed.data.field]: parsed.data.enabled,
  };
  const { error } = await service.from("triage_settings").upsert(
    { property_id: propertyId, auto_apply: autoApply, updated_at: new Date().toISOString() },
    { onConflict: "property_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ autoApply });
}
