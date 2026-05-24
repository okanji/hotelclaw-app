import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import { propertyIdFromRoomId } from "@/lib/liveblocks/rooms";

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

  const memberPropertyIds = new Set(
    (memberships ?? []).map((m) => m.property_id),
  );

  const liveblocks = getLiveblocksServer();
  const session = liveblocks.prepareSession(user.id, {
    userInfo: {
      name: profile?.full_name ?? user.email ?? user.id,
      avatar: profile?.avatar_url ?? undefined,
    },
  });

  if (room) {
    // Without this check, any logged-in user could request access to any room
    // id (e.g. `property:<other-property-uuid>:doc:<any>`) and Liveblocks would
    // grant FULL_ACCESS, leaking every other tenant's documents/tasks/boards.
    const requestedProperty = propertyIdFromRoomId(room);
    if (!requestedProperty || !memberPropertyIds.has(requestedProperty)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    session.allow(room, session.FULL_ACCESS);
  } else {
    for (const propertyId of memberPropertyIds) {
      session.allow(`property:${propertyId}:*`, session.FULL_ACCESS);
    }
  }

  const { status, body } = await session.authorize();
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
