import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStreamVideoServer } from "@/lib/stream/video-server";

/**
 * Mint a Stream Video JWT for the authenticated user. Mirrors the chat token
 * route — same auth gate (Supabase user), same env-driven signing. Returns
 * apiKey + userId alongside the token so the client provider has everything
 * it needs to call `new StreamVideoClient` without a second round-trip.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing NEXT_PUBLIC_STREAM_API_KEY" },
      { status: 500 },
    );
  }

  const token = getStreamVideoServer().generateUserToken({
    user_id: user.id,
    validity_in_seconds: 60 * 60 * 12, // 12h — chat token is server-default 1h; video calls can run long
  });

  return NextResponse.json({ token, apiKey, userId: user.id });
}
