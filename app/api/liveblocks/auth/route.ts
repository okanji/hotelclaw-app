import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveblocksServer } from "@/lib/liveblocks/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Liveblocks POSTs `{ room }` when connecting to a document/task room.
  let room: string | undefined;
  try {
    const body = (await request.json()) as { room?: string };
    room = typeof body.room === "string" ? body.room : undefined;
  } catch {
    // Notifications-only auth calls may omit a body.
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

  if (room) {
    session.allow(room, session.FULL_ACCESS);
  } else {
    for (const m of memberships ?? []) {
      session.allow(`property:${m.property_id}:*`, session.FULL_ACCESS);
    }
  }

  const { status, body } = await session.authorize();
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
