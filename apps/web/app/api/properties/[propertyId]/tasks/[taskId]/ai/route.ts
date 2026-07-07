import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runTaskBot } from "@/lib/ai/bots/task-bot";

/**
 * POST /api/properties/:propertyId/tasks/:taskId/ai
 *
 * Task-bot turn. Caller posts the conversation so far (or a single user
 * message for first turn); the bot generates the next assistant turn and
 * we return its text.
 *
 * No persistence (yet): the client owns the conversation array and sends
 * it on each turn. Engaged-mode-style Redis persistence isn't needed for
 * the task surface — conversations are short and tightly scoped.
 *
 * Auth: caller must be a member of the property. RLS catches it at the
 * data layer too, but explicit check gives a clean 403 rather than a
 * confusing tool error.
 */

const TurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const Body = z.object({
  messages: z.array(TurnSchema).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Defense-in-depth: ensure caller is a member of the property.
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Verify the task belongs to this property (so the propertyId in the
  // URL can't be spoofed to point at a different tenant's task).
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (err) {
    console.error("[task-bot] invalid json", err);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const result = await runTaskBot({
      propertyId,
      userId: user.id,
      taskId,
      messages: parsed.data.messages,
    });
    return NextResponse.json({ reply: result.text });
  } catch (err) {
    console.error("[task-bot] runTaskBot failed", err);
    return NextResponse.json(
      { error: "generation failed" },
      { status: 500 },
    );
  }
}
