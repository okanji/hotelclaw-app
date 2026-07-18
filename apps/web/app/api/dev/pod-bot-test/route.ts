import { NextResponse, type NextRequest } from "next/server";
import { maybePodBotReply } from "@/lib/stream/pod-bot-reply";

/**
 * Dev-only harness entry for the pod-bot chat glue: lets
 * scripts/pod-bot-chat-test.mjs exercise the exact webhook code path
 * (addressing → session mapping → eve turn → Stream reply) without
 * repointing the SHARED Stream webhook at a local tunnel. Auth: service
 * role bearer; disabled in production builds.
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
    messageId?: string;
    senderId?: string;
    senderName?: string;
    text?: string;
  };
  if (!body.propertyId || !body.channelId || !body.senderId || !body.text) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const handled = await maybePodBotReply({
    propertyId: body.propertyId,
    channelId: body.channelId,
    messageId: body.messageId ?? `dev-${Date.now()}`,
    senderId: body.senderId,
    senderName: body.senderName ?? null,
    text: body.text,
  });
  return NextResponse.json({ handled });
}
