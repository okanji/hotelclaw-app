import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveblocksServer } from "@/lib/liveblocks/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("property_id")
      .eq("user_id", user.id),
  ]);

  const liveblocks = getLiveblocksServer();
  const session = liveblocks.prepareSession(user.id, {
    userInfo: {
      name: profile?.full_name ?? user.email ?? user.id,
      avatar: profile?.avatar_url ?? undefined,
    },
  });

  for (const m of memberships ?? []) {
    session.allow(`property:${m.property_id}:*`, session.FULL_ACCESS);
  }

  const { status, body } = await session.authorize();
  return new NextResponse(body, { status });
}
