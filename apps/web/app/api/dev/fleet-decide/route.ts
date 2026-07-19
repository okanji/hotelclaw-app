import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runPodDecisionTurn } from "@/lib/stream/pod-bot-reply";

/**
 * Dev-only harness entry for the Fleet approvals mechanism: exercises the
 * exact runPodDecisionTurn path the decideApproval server action delegates
 * to (token recovery, decision turn, outcome post, park clearing) without
 * a browser session. Auth: service role bearer; disabled in production.
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    sessionRowId?: string;
    decision?: "approve" | "deny";
    actorUserId?: string;
  };
  if (!body.sessionRowId || !body.decision || !body.actorUserId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const service = createServiceClient();
  const { data: row } = await service
    .from("bot_chat_sessions")
    .select(
      "id, client_id, property_id, bot_id, channel_id, eve_session_id, eve_continuation_token",
    )
    .eq("id", body.sessionRowId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await runPodDecisionTurn({
    sessionRow: row,
    decision: body.decision,
    actorUserId: body.actorUserId,
  });
  return NextResponse.json(result);
}
