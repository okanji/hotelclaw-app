import { NextResponse, type NextRequest, after } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  generateCatchUp,
  getCachedCatchUp,
} from "@/lib/ai/bots/catch-up-bot";

/**
 * GET  /api/properties/:propertyId/catch-up/:subjectKind/:subjectId
 *      The caller's "since you last looked" summary for one project/space —
 *      cached row immediately, regeneration in after() (same SWR pattern as
 *      the shift brief). Any member role.
 * POST {action:"seen"} — advance the cursor ("Mark read").
 */

const KINDS = ["project", "space"] as const;

async function resolveSubject(
  propertyId: string,
  subjectKind: string,
  subjectId: string,
): Promise<{ kind: (typeof KINDS)[number]; name: string } | null> {
  if (!(KINDS as readonly string[]).includes(subjectKind)) return null;
  if (!z.string().uuid().safeParse(subjectId).success) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from(subjectKind === "project" ? "projects" : "spaces")
    .select("id, name")
    .eq("id", subjectId)
    .eq("property_id", propertyId)
    .maybeSingle();
  return data
    ? { kind: subjectKind as (typeof KINDS)[number], name: data.name }
    : null;
}

type Params = Promise<{
  propertyId: string;
  subjectKind: string;
  subjectId: string;
}>;

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  const { propertyId, subjectKind, subjectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const subject = await resolveSubject(propertyId, subjectKind, subjectId);
  if (!subject) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const cached = await getCachedCatchUp(
      propertyId,
      user.id,
      subject.kind,
      subjectId,
    );
    after(async () => {
      try {
        await generateCatchUp({
          propertyId,
          userId: user.id,
          subjectKind: subject.kind,
          subjectId,
          subjectName: subject.name,
        });
      } catch (err) {
        console.error("[catch-up] revalidation failed", err);
      }
    });
    return NextResponse.json({ catchUp: cached, pending: cached === null });
  } catch (err) {
    console.error("[catch-up] fetch failed", err);
    return NextResponse.json({ error: "catch-up failed" }, { status: 500 });
  }
}

const Body = z.object({ action: z.literal("seen") });

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
) {
  const { propertyId, subjectKind, subjectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const subject = await resolveSubject(propertyId, subjectKind, subjectId);
  if (!subject) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.from("catch_ups").upsert(
    {
      property_id: propertyId,
      user_id: user.id,
      subject_kind: subject.kind,
      subject_id: subjectId,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "property_id,user_id,subject_kind,subject_id" },
  );
  if (error) {
    console.error("[catch-up] seen failed", error.message);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
