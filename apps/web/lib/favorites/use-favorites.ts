"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { FavoriteKind } from "@/lib/db/types";

/**
 * The caller's favorites in one property (migration 0120): projects, teams,
 * docs, forms and channels. Tasks are starred in `task_favorites` (the task
 * star) — the Favorites page reads both. Server-side and per user, so a star
 * follows you across devices; realtime keeps every star in sync.
 */

export type FavoriteRow = { kind: FavoriteKind; entity_id: string; created_at: string };

export function favoritesQueryOptions(propertyId: string) {
  return {
    queryKey: ["favorites", propertyId] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<FavoriteRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("favorites")
        .select("kind, entity_id, created_at")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  };
}

const EMPTY: FavoriteRow[] = [];

export type UseFavorites = {
  rows: FavoriteRow[];
  isPending: boolean;
  /** Ids of one kind, most recently starred first. */
  idsOf: (kind: FavoriteKind) => string[];
  isFavorite: (kind: FavoriteKind, id: string) => boolean;
  /** Optimistic toggle; reverts and toasts on failure. */
  toggle: (kind: FavoriteKind, id: string, label?: string) => Promise<void>;
};

export function useFavorites(
  propertyId: string,
  opts: { realtime?: boolean } = {},
): UseFavorites {
  const qc = useQueryClient();
  const key = useMemo(() => ["favorites", propertyId] as const, [propertyId]);
  const { data: rows = EMPTY, isPending } = useQuery(favoritesQueryOptions(propertyId));
  // Realtime is opt-in: the Favorites page and the sidebar subscribe; a star
  // button relies on the shared cache they keep fresh.
  useFavoritesRealtime(opts.realtime ? propertyId : null);

  const set = useMemo(() => new Set(rows.map((r) => `${r.kind}:${r.entity_id}`)), [rows]);
  const isFavorite = useCallback(
    (kind: FavoriteKind, id: string) => set.has(`${kind}:${id}`),
    [set],
  );
  const idsOf = useCallback(
    (kind: FavoriteKind) => rows.filter((r) => r.kind === kind).map((r) => r.entity_id),
    [rows],
  );

  const toggle = useCallback(
    async (kind: FavoriteKind, id: string, label?: string) => {
      const on = set.has(`${kind}:${id}`);
      const prev = qc.getQueryData<FavoriteRow[]>(key) ?? [];
      qc.setQueryData<FavoriteRow[]>(
        key,
        on
          ? prev.filter((r) => !(r.kind === kind && r.entity_id === id))
          : [{ kind, entity_id: id, created_at: new Date().toISOString() }, ...prev],
      );
      const supabase = createClient();
      const { error } = on
        ? await supabase
            .from("favorites")
            .delete()
            .eq("property_id", propertyId)
            .eq("kind", kind)
            .eq("entity_id", id)
        : await supabase
            .from("favorites")
            .upsert(
              { property_id: propertyId, kind, entity_id: id },
              { onConflict: "user_id,kind,entity_id", ignoreDuplicates: true },
            );
      if (error) {
        qc.setQueryData(key, prev);
        toast.error("Couldn't update favorites");
        return;
      }
      toast(on ? "Removed from favorites" : label ? `Added ${label} to favorites` : "Added to favorites", {
        duration: 1800,
      });
    },
    [qc, key, set, propertyId],
  );

  return { rows, isPending, idsOf, isFavorite, toggle };
}

/** Live `favorites` for the signed-in user (null = not subscribed). */
function useFavoritesRealtime(propertyId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!propertyId) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`favorites:${uid}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "favorites", filter: `user_id=eq.${uid}` },
          () => void qc.invalidateQueries({ queryKey: ["favorites", propertyId] }),
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [qc, propertyId]);
}

