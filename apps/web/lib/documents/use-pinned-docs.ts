"use client";

import { useCallback, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useFavorites } from "@/lib/favorites/use-favorites";

/**
 * Pinned documents = favorite documents (`favorites`, kind `document`,
 * migration 0120). Same hook surface the docs Home "Pinned" section and the
 * Home widgets always used, now server-side and per user, so a pin follows
 * you across devices and shows on the Favorites page.
 *
 * v1 kept pins in `localStorage` per device. The first mount on a device
 * imports any such pins into the table once, then clears the local key.
 */

const KEY_PREFIX = "hotelclaw:doc-pins:";

function readLegacy(propertyId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${propertyId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
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
  const qc = useQueryClient();
  const { idsOf, isFavorite, toggle } = useFavorites(propertyId);
  const pinnedIds = useMemo(() => idsOf("document"), [idsOf]);

  // One-time import of this device's v1 localStorage pins.
  useEffect(() => {
    const legacy = readLegacy(propertyId);
    if (!legacy.length) return;
    const supabase = createClient();
    void supabase
      .from("favorites")
      .upsert(
        legacy.map((id) => ({ property_id: propertyId, kind: "document" as const, entity_id: id })),
        { onConflict: "user_id,kind,entity_id", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (error) return; // keep the local pins; retry next mount
        try {
          window.localStorage.removeItem(`${KEY_PREFIX}${propertyId}`);
        } catch {
          // ignore
        }
        void qc.invalidateQueries({ queryKey: ["favorites", propertyId] });
      });
  }, [propertyId, qc]);

  const isPinned = useCallback((id: string) => isFavorite("document", id), [isFavorite]);
  const togglePin = useCallback(
    (id: string) => {
      const next = !isFavorite("document", id);
      void toggle("document", id);
      return next;
    },
    [isFavorite, toggle],
  );

  return { pinnedIds, isPinned, togglePin };
}
