import { NextResponse, type NextRequest } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Mint a one-time login token so the mobile app's WebView can establish its
 * OWN cookie session, independent of the native app's session.
 *
 * Why not hand the WebView the native access+refresh tokens (the original
 * mobile-bridge design)? Supabase rotates refresh tokens as a family: once
 * the WebView's browser client refreshed the shared token, the native app's
 * stored copy became a stale ancestor, and its next refresh could tear down
 * the whole family — the app signed itself out just by having opened a
 * document. Caught live in the 2026-08-18 smoke test. A `generateLink`
 * magic-link hash starts a brand-new session family for the WebView instead
 * (the same mechanism the invite flow already uses).
 *
 * Auth: Bearer only — this endpoint exists for the native app. The link is
 * always minted for the CALLER's own email, so it can never escalate.
 */
export async function POST(request: NextRequest) {
  const { user, isBearer } = await resolveApiCaller(request);
  if (!user?.email || !isBearer) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });

  if (error || !data?.properties?.hashed_token) {
    console.error("[mobile-session] generateLink failed", error);
    return NextResponse.json(
      { error: "Couldn't create a session for the app view." },
      { status: 500 },
    );
  }

  return NextResponse.json({ token_hash: data.properties.hashed_token });
}
