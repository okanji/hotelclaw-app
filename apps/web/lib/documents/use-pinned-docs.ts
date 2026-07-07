"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-property memory of which documents the user has pinned, kept in
 * `localStorage`. Surfaced on the docs Home page as a "Pinned" section so the
 * docs the user cares about most stay one click away.
 *
 * v1 storage is client-only: pins live on this device and don't sync to
 * others. If we ever want cross-device pins, swap the implementation for a
 * `document_pins` table behind the same hook surface.
 *
 * A miss (first visit, cleared / disabled storage) is harmless — every read
 * and write tolerates failure, the Pinned section just stays empty.
 */

const KEY_PREFIX = "hotelclaw:doc-pins:";
const STORAGE_EVENT = "hotelclaw:doc-pins:changed";

function storageKey(propertyId: string): string {
  return `${KEY_PREFIX}${propertyId}`;
}

function read(propertyId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(propertyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function write(propertyId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(storageKey(propertyId), JSON.stringify(ids));
    // Broadcast to other hook instances in the same tab — the native
    // `storage` event only fires across tabs, not within one.
    window.dispatchEvent(
      new CustomEvent(STORAGE_EVENT, { detail: { propertyId } }),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

export type UsePinnedDocs = {
  /** Ordered list of pinned doc ids — most recently pinned first. */
  pinnedIds: string[];
  isPinned: (id: string) => boolean;
  /** Toggle pin state. Returns the next pinned state for `id`. */
  togglePin: (id: string) => boolean;
};

export function usePinnedDocs(propertyId: string): UsePinnedDocs {
  // SSR-safe initial: empty on first render, then re-read from localStorage
  // post-hydration. Reading window.localStorage during render would diverge
  // server vs client and trigger a hydration mismatch.
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPinnedIds(read(propertyId));

    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ propertyId: string }>).detail;
      if (detail?.propertyId !== propertyId) return;
      setPinnedIds(read(propertyId));
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey(propertyId)) return;
      setPinnedIds(read(propertyId));
    }
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [propertyId]);

  const togglePin = useCallback(
    (id: string) => {
      const current = read(propertyId);
      const exists = current.includes(id);
      const next = exists
        ? current.filter((x) => x !== id)
        : // Newest pin first — matches the Home rendering order.
          [id, ...current];
      write(propertyId, next);
      setPinnedIds(next);
      return !exists;
    },
    [propertyId],
  );

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  return { pinnedIds, isPinned, togglePin };
}
