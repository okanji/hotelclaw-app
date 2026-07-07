import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createStreamUserToken, upsertStreamUser } from "@/lib/stream/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const token = createStreamUserToken(user.id);
  return NextResponse.json({ token });
}
