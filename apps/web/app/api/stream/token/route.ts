import { type NextRequest, NextResponse } from "next/server";
import { resolveApiCaller } from "@/lib/auth/api-caller";
import { createStreamUserToken, upsertStreamUser } from "@/lib/stream/server";

// Bearer-path tokens (mobile) expire and are re-fetched by the app's Stream
// tokenProvider. Cookie-path tokens (web) stay non-expiring for now because the
// web client connects with a static token, not a provider.
const MOBILE_TOKEN_TTL_SECONDS = 60 * 60 * 12;

export async function GET(request: NextRequest) {
  const { supabase, user, isBearer } = await resolveApiCaller(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  await upsertStreamUser({
    id: user.id,
    name: profile?.full_name ?? user.email ?? user.id,
    image: profile?.avatar_url ?? null,
  });

  const token = createStreamUserToken(
    user.id,
    isBearer ? MOBILE_TOKEN_TTL_SECONDS : undefined,
  );
  return NextResponse.json({ token });
}
