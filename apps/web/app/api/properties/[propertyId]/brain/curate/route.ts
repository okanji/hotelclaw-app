import { NextResponse } from "next/server";
import { z } from "zod";
import { getMembershipForProperty, getSessionUser } from "@/lib/auth/session";
import { resolvePropertyBrain } from "@/lib/brain/client";
import { archiveBrainPage, captureBrainCorrection } from "@/lib/brain/browse";

/**
 * `POST /api/properties/:propertyId/brain/curate` — the two curation verbs
 * the Brain browser exposes:
 *
 *   { action: "correction", slug, note, supersedes? } — owner/manager.
 *     Appends a marked operator correction to the page timeline
 *     (supersede-by-append; a direct page edit would be clobbered by the
 *     dream cycle, an appended correction survives it).
 *   { action: "archive", slug } — owner only. Soft-deletes the page
 *     (72h recovery window on the serve).
 *
 * Role comes from the caller's RLS membership read (org-chart pattern);
 * tenancy is the property-scoped brain binding resolved server-side.
 */
const CurateBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("correction"),
    slug: z.string().min(1).max(300),
    note: z.string().min(3).max(500),
    supersedes: z
      .object({ date: z.string().max(20), summary: z.string().max(300) })
      .optional(),
  }),
  z.object({
    action: z.literal("archive"),
    slug: z.string().min(1).max(300),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const [user, membership] = await Promise.all([
    getSessionUser(),
    getMembershipForProperty(propertyId),
  ]);
  if (!user || !membership) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = CurateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  const allowed =
    body.action === "archive"
      ? membership.role === "owner"
      : membership.role === "owner" || membership.role === "manager";
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const binding = await resolvePropertyBrain(propertyId);
  if (!binding) {
    return NextResponse.json({ unavailable: true, reason: "no brain provisioned" });
  }

  const author =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    user.id;
  const result =
    body.action === "correction"
      ? await captureBrainCorrection(binding, {
          slug: body.slug,
          note: body.note,
          author,
          supersedes: body.supersedes,
        })
      : await archiveBrainPage(binding, body.slug);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
