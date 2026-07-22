import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { processImportedTranscript } from "@/lib/meetings/summarize";

// POST /api/properties/:propertyId/meetings/import — H1: bring an external
// recorder's transcript through the native meeting pipeline (summary, action
// items, transcript doc, optional channel post). Synchronous — the summary
// model call runs within the request; imports are an explicit user action.

const Body = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().min(40).max(400_000),
  channelId: z.string().uuid().nullable().optional(),
});

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

  // Tenancy: an optional channel must belong to this property.
  if (parsed.data.channelId) {
    const { data: channel } = await supabase
      .from("chat_channels")
      .select("id")
      .eq("id", parsed.data.channelId)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }
  }

  const result = await processImportedTranscript({
    propertyId,
    hostId: user.id,
    title: parsed.data.title,
    rawText: parsed.data.text,
    channelId: parsed.data.channelId ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ meetingId: result.meetingId });
}
