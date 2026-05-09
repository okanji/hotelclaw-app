import "server-only";
import { Liveblocks } from "@liveblocks/node";

let _client: Liveblocks | null = null;

export function getLiveblocksServer() {
  if (_client) return _client;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) throw new Error("Missing LIVEBLOCKS_SECRET_KEY");
  _client = new Liveblocks({ secret });
  return _client;
}

export function roomIdForBoard(propertyId: string) {
  return `property:${propertyId}:tasks`;
}

export function roomIdForTask(propertyId: string, taskId: string) {
  return `property:${propertyId}:task:${taskId}`;
}
