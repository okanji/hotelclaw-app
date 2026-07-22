import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
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

  // Accepted routing decisions are institutional memory: "tasks like this
  // go to X" is exactly what future triage should learn from. Fail-soft,
  // off the response path. Dismissals are noise — skip them.
  if (parsed.data.action === "accept") {
    after(async () => {
      try {
        const { resolvePropertyBrain, captureToBrain } = await import(
          "@/lib/brain/client"
        );
        const binding = await resolvePropertyBrain(propertyId);
        if (!binding) return;
        const { data: task } = await service
          .from("tasks")
          .select("title, space_id, assignee_id, priority, spaces(name)")
          .eq("id", taskId)
          .maybeSingle();
        if (!task) return;
        const target =
          suggestion.field === "space"
            ? `team "${(task.spaces as { name?: string } | null)?.name ?? suggestion.suggested_value}"`
            : suggestion.field === "assignee"
              ? `assignee ${suggestion.suggested_value}`
              : `priority ${suggestion.suggested_value}`;
        await captureToBrain(binding, {
          slug: "operations/triage-routing",
          pageTitle: "Task routing memory",
          summary: `Task "${String(task.title).slice(0, 120)}" → ${target} (triage suggestion accepted by staff).`,
          source: `triage, ${new Date().toISOString().slice(0, 10)}`,
        });
      } catch (err) {
        const { logBrainEvent } = await import("@/lib/brain/telemetry");
        logBrainEvent("capture_failed", {
          surface: "triage-routing",
          propertyId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}
