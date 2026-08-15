import { NextResponse, type NextRequest } from "next/server";
import { saveWorkflow } from "@/lib/workflows/save";

/**
 * Dev-only harness entry for `saveWorkflow`. The workflows API is
 * cookie-authenticated, so a script cannot reach the save path — and the save
 * path is exactly what has to be tested: it is where `reconcileCronSchedule`
 * decides whether a `schedule.cron` workflow gets a real pg_cron job.
 *
 * A spec whose cron sits under `trigger.filter` instead of `trigger.schedule`
 * validates cleanly and schedules nothing; the only way to catch that is to
 * run this and then ask Postgres whether a job exists
 * (scripts/assistant-schedule-smoke.mjs).
 *
 * Auth: service-role bearer; 404 in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    workflowId?: string;
    propertyId?: string;
    userId?: string;
    enabled?: boolean;
    spec?: unknown;
  };
  if (!body.workflowId || !body.propertyId || !body.userId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  try {
    const result = await saveWorkflow({
      workflowId: body.workflowId,
      propertyId: body.propertyId,
      userId: body.userId,
      enabled: body.enabled ?? true,
      ...(body.spec !== undefined ? { spec: body.spec } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
