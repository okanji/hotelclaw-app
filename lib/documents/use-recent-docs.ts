"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-property memory of recently opened documents, kept in `localStorage`.
 * Powers the "Recently opened" section on the docs Home page.
 *
 * Like `usePinnedDocs`, this is client-only — recents are per-device. The
 * recorder lives on the doc detail route so every open path (sidebar click,
 * breadcrumb, deep link, search jump) records here.
 */

const KEY_PREFIX = "hotelclaw:doc-recents:";
const STORAGE_EVENT = "hotelclaw:doc-recents:changed";
const MAX_ENTRIES = 20;

export type RecentDocEntry = { id: string; openedAt: string };

function storageKey(propertyId: string): string {
  return `${KEY_PREFIX}${propertyId}`;
}

function read(propertyId: string): RecentDocEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(propertyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentDocEntry =>
          !!x &&
          typeof x === "object" &&
          typeof (x as RecentDocEntry).id === "string" &&
          typeof (x as RecentDocEntry).openedAt === "string",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function write(propertyId: string, entries: RecentDocEntry[]): void {
  try {
    window.localStorage.setItem(
      storageKey(propertyId),
      JSON.stringify(entries),
    );
    window.dispatchEvent(
      new CustomEvent(STORAGE_EVENT, { detail: { propertyId } }),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

/** Returns recently opened docs (most-recent first). */
export function useRecentDocs(propertyId: string): RecentDocEntry[] {
  const [recents, setRecents] = useState<RecentDocEntry[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecents(read(propertyId));

    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ propertyId: string }>).detail;
      if (detail?.propertyId !== propertyId) return;
      setRecents(read(propertyId));
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey(propertyId)) return;
      setRecents(read(propertyId));
    }
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [propertyId]);

  return recents;
}

/**
 * Records `documentId` as the most recently opened doc for `propertyId`.
 * Dedupes on id (an existing entry moves to the top) and caps the list at
 * `MAX_ENTRIES`. Safe to call from a render-time `useEffect` — best-effort
 * write, no exceptions surfaced.
 */
export function recordRecentDoc(propertyId: string, documentId: string): void {
  if (typeof window === "undefined") return;
  const current = read(propertyId);
  const filtered = current.filter((e) => e.id !== documentId);
  const next: RecentDocEntry[] = [
    { id: documentId, openedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, MAX_ENTRIES);
  write(propertyId, next);
}

/** Clears every recents entry for `propertyId` — used by a "Clear recents" action. */
export function clearRecentDocs(propertyId: string): void {
  if (typeof window === "undefined") return;
  write(propertyId, []);
}
