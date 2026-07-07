import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import {
  classifyConversations,
  getChatbotAnalytics,
} from "@/lib/chatbots/analytics";

/**
 * GET .../analytics — aggregates for the Analytics tab. Classification is
 * lazy: any settled conversations still missing topic/sentiment get one
 * batched Haiku pass first (cached on the rows), then the deterministic
 * aggregates are computed.
 */

export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; chatbotId: string }> },
) {
  const { propertyId, chatbotId } = await params;
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data: bot } = await supabase
    .from("chatbots")
    .select("id")
    .eq("id", chatbotId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!bot) return NextResponse.json({ error: "chatbot not found" }, { status: 404 });

  const labeled = await classifyConversations({ chatbotId, propertyId });
  const analytics = await getChatbotAnalytics({ chatbotId, propertyId });
  return NextResponse.json({ ...analytics, newlyLabeled: labeled });
}
