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
 * The calendar room — one per property, not per-user. Everyone in the
 * property who has the calendar open joins the same room so they show up
 * in each other's avatar stacks + cursor overlays. AI chats are stored
 * per user via a separate chatId; the room is for presence and broadcasts,
 * not chat state.
 */
export function roomIdForCalendar(propertyId: string) {
  return `property:${propertyId}:calendar`;
}

/**
 * The workflow-builder room — one per workflow. Everyone editing the same
 * workflow joins it for live presence (avatar stack, "Alice is on step 3") and
 * a live spec mirror. Follows the `property:<pid>:...` shape so the Liveblocks
 * auth route's tenant check authorizes it without changes.
 */
export function roomIdForWorkflow(propertyId: string, workflowId: string) {
  return `property:${propertyId}:workflow:${workflowId}`;
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

/**
 * Parse a document room id (`property:<pid>:doc:<did>`) into its parts. Used
 * by the Liveblocks `ydocUpdated` webhook (`app/api/liveblocks/webhook/route.ts`)
 * to route a snapshot back to the right `documents` row. Returns `null` for
 * any other room shape — task rooms, board rooms, malformed ids — so callers
 * can ignore non-doc traffic without false matches.
 */
export function parseDocumentRoomId(
  roomId: string,
): { propertyId: string; documentId: string } | null {
  const parts = roomId.split(":");
  if (parts.length !== 4) return null;
  const [scope, propertyId, kind, documentId] = parts;
  if (scope !== "property" || kind !== "doc" || !propertyId || !documentId) {
    return null;
  }
  return { propertyId, documentId };
}
