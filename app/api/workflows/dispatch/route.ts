import { NextResponse, type NextRequest, after } from "next/server";
import { dispatchEvent } from "@/lib/workflows/dispatcher";

// Internal dispatch endpoint. Webhook handlers and the drain cron call this
// with an event id. We process via after() so the caller (often a webhook
// race trying to dispatch in-process) doesn't block on the workflow runtime.
//
// Security: protected by `INTERNAL_DISPATCH_SECRET` — set in env, checked via
// the `x-dispatch-secret` header. The webhook handlers + drain route are the
// only callers; users never hit this directly.

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-dispatch-secret");
  if (process.env.INTERNAL_DISPATCH_SECRET && secret !== process.env.INTERNAL_DISPATCH_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { event_id?: string };
  try {
    body = (await request.json()) as { event_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!body.event_id) {
    return NextResponse.json({ error: "missing event_id" }, { status: 400 });
  }

  const eventId = body.event_id;
  after(async () => {
    try {
      await dispatchEvent(eventId);
    } catch (err) {
      console.error("[api/workflows/dispatch] failed", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}
