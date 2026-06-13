import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { trainChatbot } from "@/lib/chatbots/ingest";

/**
 * POST /api/properties/:propertyId/chatbots/:chatbotId/train
 *
 * (Re)build the bot's knowledge chunks from its sources. Runs inline —
 * chunking is string work and url/document sources are size-capped, so
 * typical training finishes in single-digit seconds.
 */

export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; chatbotId: string }> },
) {
  const { propertyId, chatbotId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: bot } = await supabase
    .from("chatbots")
    .select("id")
    .eq("id", chatbotId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!bot) return NextResponse.json({ error: "chatbot not found" }, { status: 404 });

  try {
    const result = await trainChatbot({ chatbotId, propertyId });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[chatbot-train] failed", err);
    return NextResponse.json({ error: "training failed" }, { status: 500 });
  }
}
