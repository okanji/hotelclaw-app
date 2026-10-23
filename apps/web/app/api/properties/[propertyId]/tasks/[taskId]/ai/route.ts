import { NextResponse, type NextRequest } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { streamTaskBot } from "@/lib/ai/bots/task-bot";
import { PanelChatBody, panelMessagesToModel } from "@/lib/ai/ui-messages";

/**
 * POST /api/properties/:propertyId/tasks/:taskId/ai
 *
 * Task-bot turn, STREAMED as an AI SDK UI message stream (text deltas +
 * reasoning + tool parts), consumed by `useChat` on web and the stream
 * reader on mobile. The client owns the conversation and posts it whole
 * each turn — no server-side persistence (task conversations are short and
 * tightly scoped). Accepts `UIMessage[]` or legacy `{role, content}` turns.
 *
 * Auth: cookie OR Supabase bearer (mobile), and the caller must be a member
 * of the property. RLS catches it at the data layer too, but the explicit
 * check gives a clean 403 rather than a confusing tool error.
 */
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { propertyId, taskId } = await params;
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
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = PanelChatBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    return await streamTaskBot({
      propertyId,
      userId: user.id,
      taskId,
      messages: await panelMessagesToModel(parsed.data.messages),
    });
  } catch (err) {
    console.error("[task-bot] streamTaskBot failed", err);
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
