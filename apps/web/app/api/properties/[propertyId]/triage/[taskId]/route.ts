import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import {
  AcceptTriageSchema,
  DeclineTriageSchema,
  acceptTriageTaskFor,
  declineTriageTaskFor,
} from "@/lib/tasks/triage-queue";

const Body = z.discriminatedUnion("action", [
  AcceptTriageSchema.omit({ taskId: true, propertyId: true }).extend({
    action: z.literal("accept"),
  }),
  DeclineTriageSchema.omit({ taskId: true, propertyId: true }).extend({
    action: z.literal("decline"),
  }),
]);

/**
 * `POST /api/properties/:propertyId/triage/:taskId`
 *   `{ action: "accept", spaceId?, assigneeId?, priority?, projectId? }`
 *   `{ action: "decline", note? }`
 * Mobile's twin of the `acceptTriageTask` / `declineTriageTask` actions —
 * the same `lib/tasks/triage-queue` functions run either way. 409 when
 * someone else already triaged it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { action, ...rest } = parsed.data;
  const result =
    action === "accept"
      ? await acceptTriageTaskFor(supabase, user.id, { ...rest, taskId, propertyId })
      : await declineTriageTaskFor(supabase, user.id, { ...rest, taskId, propertyId });

  if ("error" in result) {
    const status = result.error === "Already triaged" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
