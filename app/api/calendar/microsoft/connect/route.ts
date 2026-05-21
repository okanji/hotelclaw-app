import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizationUrl } from "@/lib/calendar/microsoft";
import { startOAuth } from "@/lib/calendar/oauth-state";

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
            : "Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI in .env.local.",
      },
      { status: 500 },
    );
  }
}
