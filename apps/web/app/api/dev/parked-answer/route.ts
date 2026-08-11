import { NextResponse, type NextRequest } from "next/server";
import { routeAnswerToParkedSession } from "@/lib/stream/channel-bot-eve";

/**
 * Dev-only harness entry for the PARKED-QUESTION answer path — the gate the
 * Stream webhook runs before its ai_mode dispatch (app/api/stream/webhook/
 * message-new/route.ts). Same shape as /api/dev/fleet-decide: it drives the
 * real function, so a test proves the production path rather than a mock.
 *
 * This exists because the alternative is repointing the SHARED Stream
 * message.new webhook at a tunnel, which silences the prod bot for the
 * duration of every test run.
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
    propertyId?: string;
    channelId?: string;
    channelType?: "team" | "messaging";
    parentId?: string | null;
    text?: string;
    userId?: string;
    userName?: string | null;
    messageId?: string;
  };
  if (!body.propertyId || !body.channelId || !body.text || !body.userId) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const route = await routeAnswerToParkedSession({
    propertyId: body.propertyId,
    streamChannelId: body.channelId,
    channelType: body.channelType ?? "team",
    parentId: body.parentId ?? null,
    triggerMessage: {
      id: body.messageId ?? `dev-${crypto.randomUUID()}`,
      text: body.text,
      userId: body.userId,
      userName: body.userName ?? null,
    },
  });
  return NextResponse.json({ route });
}
