import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runInsightsQaBot } from "@/lib/ai/bots/insights-qa-bot";
import { parseScope, PROPERTY_SCOPE } from "@/lib/insights/scope";

/**
 * POST /api/properties/:propertyId/insights/ask
 *
 * One turn of the insights Q&A bot ("Ask the numbers"). Stateless: the
 * client owns the transcript and posts it whole each turn, plus the lens
 * the page is currently viewing — the same pattern as the task bot.
 * Non-streaming for now (runBot is the uniform Tier-1 runtime; tool
 * latency dominates the wait anyway).
 *
 * Owner/manager only — the bot's toolset includes workload and operations
 * aggregates that staff sessions must never see (same gate as the brief).
 */

export const maxDuration = 60;

const TurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

const Body = z.object({
  messages: z.array(TurnSchema).min(1).max(30),
  scope: z.string().optional(),
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
    const result = await runInsightsQaBot({
      propertyId,
      userId: user.id,
      scope: parseScope(parsed.data.scope) ?? PROPERTY_SCOPE,
      messages: parsed.data.messages,
    });
    return NextResponse.json({ reply: result.text });
  } catch (err) {
    console.error("[insights-qa] failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
