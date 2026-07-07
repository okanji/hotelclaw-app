import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMembershipForProperty } from "@/lib/auth/session";
import { runWorkflowAuthorBot } from "@/lib/ai/bots/workflow-author-bot";
import { WorkflowSpec } from "@/lib/workflows/spec";

// POST /api/properties/:propertyId/workflows/author
//
// Body: { goal: string, currentSpec?: WorkflowSpec, conversation?: ModelMessage[] }
// Response (one of):
//   { kind: "spec", spec, narration }
//   { kind: "clarification", question, suggestions, narration }
//   { kind: "propose_entity_type", entity, narration }
//   { kind: "error", message }
//
// Auth: caller must be a member of the property. Streaming is deferred — v1
// returns the full result in one response (the bot finishes in a few seconds
// with temperature 0). When we adopt ai-elements streaming we'll switch this
// to a UIMessage stream.

const Turn = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.union([z.string(), z.array(z.unknown())]),
});

const Body = z.object({
  goal: z.string().min(1).max(4000),
  currentSpec: z.unknown().optional(),
  conversation: z.array(Turn).optional(),
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
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const membership = await getMembershipForProperty(propertyId);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: "invalid body", detail: String(err) }, { status: 400 });
  }

  // Coerce currentSpec into a typed WorkflowSpec or null.
  let currentSpec: WorkflowSpec | null = null;
  if (body.currentSpec) {
    const parsed = WorkflowSpec.safeParse(body.currentSpec);
    if (parsed.success) currentSpec = parsed.data;
  }

  try {
    const outcome = await runWorkflowAuthorBot({
      propertyId,
      userId: user.id,
      goal: body.goal,
      conversation: body.conversation as Parameters<typeof runWorkflowAuthorBot>[0]["conversation"],
      currentSpec,
    });
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("[workflows/author] runWorkflowAuthorBot failed", err);
    return NextResponse.json(
      {
        kind: "error",
        message: err instanceof Error ? err.message : "author bot failed",
      },
      { status: 500 },
    );
  }
}
