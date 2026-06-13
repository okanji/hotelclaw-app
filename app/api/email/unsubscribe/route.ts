import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET/POST /api/email/unsubscribe?token=<unsubscribe_token>
 *
 * The token IS the credential (it's a per-user random uuid that only ever
 * appears in that user's own emails) — no session required, which is what
 * one-click List-Unsubscribe demands. POST handles the RFC 8058 one-click
 * form; GET handles a human clicking the footer link.
 */

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token) return false;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("email_prefs")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .select("user_id");
  return (data?.length ?? 0) > 0;
}

function confirmationPage(ok: boolean): NextResponse {
  const body = ok
    ? "<h1>You're unsubscribed</h1><p>Hotelclaw won't email you digests or alerts anymore. You can re-enable them any time from Insights &rarr; email settings.</p>"
    : "<h1>Link not recognized</h1><p>This unsubscribe link is invalid or was already rotated.</p>";
  return new NextResponse(
    `<!DOCTYPE html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0a0a0a;">${body}</body></html>`,
    { status: ok ? 200 : 404, headers: { "Content-Type": "text/html" } },
  ) as NextResponse;
}

export async function GET(request: NextRequest) {
  const ok = await unsubscribe(request.nextUrl.searchParams.get("token"));
  return confirmationPage(ok);
}

export async function POST(request: NextRequest) {
  const ok = await unsubscribe(request.nextUrl.searchParams.get("token"));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
