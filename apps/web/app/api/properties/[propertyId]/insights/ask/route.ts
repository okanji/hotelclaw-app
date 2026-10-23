import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { streamInsightsQaBot } from "@/lib/ai/bots/insights-qa-bot";
import { PanelChatBody, panelMessagesToModel } from "@/lib/ai/ui-messages";
import { parseScope, PROPERTY_SCOPE } from "@/lib/insights/scope";

/**
 * POST /api/properties/:propertyId/insights/ask
 *
 * One turn of the insights Q&A bot ("Ask the numbers"), STREAMED as an AI
 * SDK UI message stream. Stateless: the client owns the transcript and
 * posts it whole each turn, plus the lens the page is currently viewing.
 *
 * Owner/manager only — the bot's toolset includes workload and operations
 * aggregates that staff sessions must never see (same gate as the brief).
 * Cookie OR Supabase bearer (mobile).
 */

export const maxDuration = 60;

const Body = PanelChatBody.extend({ scope: z.string().optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const { supabase, user } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Membership under the caller's own RLS client (works for cookie + bearer).
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("property_id", propertyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || membership.role === "staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    return await streamInsightsQaBot({
      propertyId,
      userId: user.id,
      scope: parseScope(parsed.data.scope) ?? PROPERTY_SCOPE,
      messages: await panelMessagesToModel(parsed.data.messages),
    });
  } catch (err) {
    console.error("[insights-qa] failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
