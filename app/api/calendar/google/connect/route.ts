import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizationUrl } from "@/lib/calendar/google";
import { startOAuth } from "@/lib/calendar/oauth-state";

/**
 * `GET /api/calendar/google/connect?next=<url>` — kicks off the Google
 * OAuth flow. Sets a CSRF state cookie + the post-callback URL, then
 * redirects to Google's consent page.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  try {
    const state = await startOAuth(next);
    return NextResponse.redirect(getAuthorizationUrl(state));
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env.local.",
      },
      { status: 500 },
    );
  }
}
