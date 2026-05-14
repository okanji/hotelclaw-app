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
