import "server-only";
import { Liveblocks } from "@liveblocks/node";

// Re-export the pure room-id helpers for server-side callers so existing
// imports (`@/lib/liveblocks/server`) keep working. Client code should
// import from `@/lib/liveblocks/rooms` instead.
export {
  roomIdForBoard,
  roomIdForTask,
  roomIdForDocument,
  propertyIdFromRoomId,
} from "./rooms";

let _client: Liveblocks | null = null;

export function getLiveblocksServer() {
  if (_client) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) throw new Error("Missing LIVEBLOCKS_SECRET_KEY");
  _client = new Liveblocks({ secret });
  return _client;
}

/**
 * Delete every Liveblocks room belonging to a property — the tasks board,
 * each per-task room and each per-document room (all keyed `property:<id>:…`,
 * see `rooms.ts`). Used when account deletion archives a property: its
 * collaborative boards and documents are torn down with it. Liveblocks has no
 * per-user delete, so room-by-property is the available unit of cleanup.
 */
export async function deletePropertyRooms(propertyId: string) {
  const lb = getLiveblocksServer();
  let cursor: string | undefined;
  do {
    const page = await lb.getRooms({
      query: `roomId^"property:${propertyId}:"`,
      startingAfter: cursor,
    });
    await Promise.all(page.data.map((room) => lb.deleteRoom(room.id)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
