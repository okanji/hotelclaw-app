import { NextResponse, type NextRequest } from "next/server";
import { WebhookHandler } from "@liveblocks/node";

/**
 * Webhook receiver for Liveblocks events (Comments, Storage, etc.).
 *
 * In stage 1 this only validates and 204s. Stage 2 will dispatch to
 * Vercel Chat SDK adapters (see lib/ai/bot-scaffold.ts) to implement bots
 * that respond in Comments threads.
 *
 * Reference: https://liveblocks.io/blog/chat-sdk-adapter-for-liveblocks
 */
export async function POST(request: NextRequest) {
  const secret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "LIVEBLOCKS_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const handler = new WebhookHandler(secret);
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  try {
    handler.verifyRequest({ headers, rawBody: body });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid signature" },
      { status: 400 },
    );
  }

  // TODO(stage 2): hand off to Vercel Chat SDK adapter for Liveblocks Comments.
  return new NextResponse(null, { status: 204 });
}
