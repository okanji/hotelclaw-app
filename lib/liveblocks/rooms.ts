/**
 * Room-id helpers. Pure string templating — usable from both server and
 * client code. Lives in its own module so client components can import these
 * without dragging in the server-only Liveblocks SDK (`lib/liveblocks/server.ts`
 * carries `import "server-only"` and would error if pulled into a client
 * component).
 */

export function roomIdForBoard(propertyId: string) {
  return `property:${propertyId}:tasks`;
}

export function roomIdForTask(propertyId: string, taskId: string) {
  return `property:${propertyId}:task:${taskId}`;
}

export function roomIdForDocument(propertyId: string, documentId: string) {
  return `property:${propertyId}:doc:${documentId}`;
}

/**
 * Pull a property uuid out of any room id we generate. Returns null for room
 * ids that don't follow the `property:<uuid>:...` shape so callers can fail
 * closed instead of leaking across tenants.
 */
export function propertyIdFromRoomId(roomId: string): string | null {
  const [scope, propertyId] = roomId.split(":");
  if (scope !== "property" || !propertyId) return null;
  return propertyId;
}
