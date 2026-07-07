import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";

/**
 * Triage suggestions on one task.
 *   GET  → pending + auto-applied rows (members; RLS-backed)
 *   POST {suggestionId, action: accept|dismiss}
 * Accepting applies the suggested field via the service client (the route
 * has already verified membership + that the task belongs to the property)
 * and stamps who resolved it — the accept/dismiss record is the trust
 * ladder's memory.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("task_suggestions")
    .select(
      "id, field, suggested_value, display_value, reasoning, confidence, status, resolved_at",
    )
    .eq("property_id", propertyId)
    .eq("task_id", taskId)
    .in("status", ["pending", "auto_applied"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suggestions: data ?? [] });
}

const Body = z.object({
  suggestionId: z.string().uuid(),
  action: z.enum(["accept", "dismiss"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: suggestion } = await service
    .from("task_suggestions")
    .select("id, field, suggested_value, status")
    .eq("id", parsed.data.suggestionId)
    .eq("property_id", propertyId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (!suggestion || suggestion.status !== "pending") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (parsed.data.action === "accept") {
    const patch =
      suggestion.field === "space"
        ? { space_id: suggestion.suggested_value }
        : suggestion.field === "assignee"
          ? { assignee_id: suggestion.suggested_value }
          : {
              priority: suggestion.suggested_value as
                | "low"
                | "medium"
                | "high"
                | "urgent",
            };
    const { error } = await service
      .from("tasks")
      .update(patch)
      .eq("id", taskId)
      .eq("property_id", propertyId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await service
    .from("task_suggestions")
    .update({
      status: parsed.data.action === "accept" ? "accepted" : "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", suggestion.id);

  return NextResponse.json({ ok: true });
}
