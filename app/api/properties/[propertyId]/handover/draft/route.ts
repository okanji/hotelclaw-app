import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runBot } from "@/lib/ai/run-bot";
import { gatherHandoverWindow } from "@/lib/insights/handover";

/**
 * POST /api/properties/:propertyId/handover/draft
 *
 * "Draft my handover" — gathers the shift window's activity
 * deterministically and asks the model for exactly four markdown sections.
 * No caching: this is one user-initiated call whose output the human edits
 * before publishing under their own name (the publish route is separate).
 */

export const maxDuration = 60;

const Body = z.object({ windowStart: z.string().datetime().optional() });

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
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const window = await gatherHandoverWindow(
      propertyId,
      user.id,
      parsed.data.windowStart,
    );
    const result = await runBot({
      persona: [
        "You draft shift handover notes for a hotel/restaurant team workspace. The next shift reads this to know what happened and what to watch.",
        "Produce EXACTLY these four markdown sections, in this order, each as an H2 heading with terse bullets under it:",
        "## Progress\n## New risks\n## Blockers\n## For next shift",
        "Every fact comes from the JSON — name the tasks, meetings, and automations it names; never invent, never add numbers of your own. A section with nothing to report gets a single bullet saying so.",
      ].join("\n"),
      scopedTools: {},
      messages: [
        {
          role: "user",
          content: `Shift window ${window.windowStart} → ${window.windowEnd}:\n${JSON.stringify(window)}\n\nDraft the handover.`,
        },
      ],
      scope: { propertyId, userId: user.id, surface: "insights" },
      responseGuidelines: "Respond with the four markdown sections only.",
      maxToolSteps: 1,
    });
    if (!result.ok) {
      return NextResponse.json({ error: "generation failed" }, { status: 502 });
    }
    return NextResponse.json({
      draft: result.text.trim(),
      window: { start: window.windowStart, end: window.windowEnd },
    });
  } catch (err) {
    console.error("[handover] draft failed", err);
    return NextResponse.json({ error: "draft failed" }, { status: 500 });
  }
}
