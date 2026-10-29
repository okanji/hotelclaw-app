import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLiveblocksServer } from "@/lib/liveblocks/server";
import {
  parseDocumentRoomId,
  parseTaskRoomId,
  propertyIdFromRoomId,
} from "@/lib/liveblocks/rooms";

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
      .select("property_id, role")
      .eq("user_id", user.id),
  ]);

  // Guests (0118) never get a property-wide wildcard: only the task / doc
  // rooms they were granted, checked per room below.
  const memberPropertyIds = new Set(
    (memberships ?? []).filter((m) => m.role !== "guest").map((m) => m.property_id),
  );
  const guestPropertyIds = new Set(
    (memberships ?? []).filter((m) => m.role === "guest").map((m) => m.property_id),
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
    if (requestedProperty && memberPropertyIds.has(requestedProperty)) {
      session.allow(room, session.FULL_ACCESS);
    } else if (requestedProperty && guestPropertyIds.has(requestedProperty)) {
      // A guest reaches a task or document room only through a grant: an
      // edit grant gets FULL access, a read grant READ access (no edits to
      // the doc or task description). Boards, calendar, workflows: never.
      const task = parseTaskRoomId(room);
      const doc = task ? null : parseDocumentRoomId(room);
      const rpc = task
        ? { fn: "can_access_task" as const, args: { tid: task.taskId } }
        : doc
          ? { fn: "can_access_document" as const, args: { did: doc.documentId } }
          : null;
      if (!rpc) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      const [{ data: canRead }, { data: canEdit }] = await Promise.all([
        supabase.rpc(rpc.fn, { ...rpc.args, need_edit: false } as never),
        supabase.rpc(rpc.fn, { ...rpc.args, need_edit: true } as never),
      ]);
      if (canRead !== true) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      session.allow(room, canEdit === true ? session.FULL_ACCESS : session.READ_ACCESS);
    } else {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    for (const propertyId of memberPropertyIds) {
      session.allow(`property:${propertyId}:*`, session.FULL_ACCESS);
    }
    // A guest-only user still needs one allowed pattern for the
    // notifications-only auth call; a private room nobody else can open.
    for (const propertyId of guestPropertyIds) {
      session.allow(`property:${propertyId}:guest:${user.id}`, session.READ_ACCESS);
    }
  }

  const { status, body } = await session.authorize();
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
