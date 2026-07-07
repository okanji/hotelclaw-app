import { NextResponse, type NextRequest, after } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  generateShiftBrief,
  getCachedShiftBrief,
} from "@/lib/ai/bots/shift-brief-bot";

/**
 * GET  /api/properties/:propertyId/insights/shift-brief
 *      The caller's own "since your last shift" brief — stale-while-
 *      revalidate, mirroring the intelligence-brief route: cached row
 *      immediately, regeneration in after(), fresh row lands via the
 *      shift_briefs realtime subscription. Every member role gets one
 *      (content is role-shaped inside the gather).
 *
 * POST /api/properties/:propertyId/insights/shift-brief {action:"seen"}
 *      Advance the caller's catch-up cursor ("Mark caught up").
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
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const cached = await getCachedShiftBrief(propertyId, user.id);
    after(async () => {
      try {
        await generateShiftBrief({
          propertyId,
          userId: user.id,
          role: membership.role,
        });
      } catch (err) {
        console.error("[shift-brief] revalidation failed", err);
      }
    });
    return NextResponse.json({ brief: cached, pending: cached === null });
  } catch (err) {
    console.error("[shift-brief] fetch failed", err);
    return NextResponse.json({ error: "brief failed" }, { status: 500 });
  }
}

const Body = z.object({ action: z.literal("seen") });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.from("shift_briefs").upsert(
    {
      property_id: propertyId,
      user_id: user.id,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "property_id,user_id" },
  );
  if (error) {
    console.error("[shift-brief] seen failed", error.message);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
