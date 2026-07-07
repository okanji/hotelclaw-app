"use client";

import { useCallback } from "react";
import { useClient } from "@liveblocks/react";
import { roomIdForDocument } from "./rooms";

/** Max concurrent prewarmed rooms. Beyond this, the oldest is released. */
const MAX_PREWARMED = 5;

/**
 * Module-level LRU pool: roomId → leave fn. `Map` iteration is insertion
 * order, so the first key is the oldest. Reusing a key requires delete + set
 * to bump it to "most recently used".
 */
const pool = new Map<string, () => void>();

/**
 * Prewarms a Liveblocks room for a document in the background so by the time
 * the user clicks the row, Yjs has already synced. Wire to `onMouseEnter`
 * (or any "intent" signal) on doc rows.
 *
 * `client.enterRoom` is reference-counted: when the user later opens the
 * doc, `<DocumentEditor>`'s `<RoomProvider>` enters the same room and shares
 * the same session — the prewarm holds an extra ref that's released on LRU
 * eviction (or when the page unloads). The pool's `MAX_PREWARMED` cap keeps
 * the open-room count bounded as the user scrolls/hovers through a long tree.
 */
export function usePrewarmDocument(propertyId: string) {
  const client = useClient();
  return useCallback(
    (documentId: string) => {
      if (!client) return;
      const roomId = roomIdForDocument(propertyId, documentId);

      const existing = pool.get(roomId);
      if (existing) {
        // Bump LRU order — re-insert at the end (most recent).
        pool.delete(roomId);
        pool.set(roomId, existing);
        return;
      }

      // Cap reached: release the oldest entry before adding the new one.
      if (pool.size >= MAX_PREWARMED) {
        const oldest = pool.keys().next().value;
        if (oldest) {
          pool.get(oldest)?.();
          pool.delete(oldest);
        }
      }

      const { leave } = client.enterRoom(roomId, {
        initialPresence: {
          cursor: null,
          selectedTaskId: null,
          draggingTaskId: null,
          editingEventId: null,
          focusedDay: null,
          selectedCell: null,
          selectionRange: null,
          activeSheetId: null,
        },
      });
      pool.set(roomId, leave);
    },
    [client, propertyId],
  );
}
