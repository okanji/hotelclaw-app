import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { setTaskFieldValueFor } from "@/lib/tasks/field-write";

/**
 * INTERNAL custom-field write for the eve runtime (service-bearer auth, like
 * /api/internal/sheets). The agent's `set_task_field` tool calls this so a
 * model-written value goes through the SAME coercion + property / team / list
 * fences as the task sidebar and workflows (`setTaskFieldValueFor`), instead
 * of a second hand-rolled copy inside the eve executor.
 */

function authorized(request: NextRequest): boolean {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

const Body = z.object({
  propertyId: z.string().uuid(),
  /** Field id or name (case-insensitive). */
  field: z.string().min(1).max(120),
  /** Free text or a typed value; null / "" clears. */
  value: z
    .union([z.string().max(5000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)])
    .nullable(),
  /** The acting person, for `updated_by` (the session's principal). */
  actorId: z.string().uuid().nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { taskId } = await params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return NextResponse.json({ error: "bad task id" }, { status: 400 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const res = await setTaskFieldValueFor(createServiceClient(), parsed.data.actorId ?? null, {
    propertyId: parsed.data.propertyId,
    taskId,
    field: parsed.data.field,
    value: parsed.data.value,
  });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 422 });
  return NextResponse.json(res);
}
