"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user, per-property memory of a dashboard-style arrangement — section
 * order and which sections are hidden — kept in `localStorage`. Home and
 * Insights share this hook, namespaced by the `name` param. Each page ships a
 * sensible default; this lets each person reorder sections and hide the ones
 * they don't need, persisted on their device. Hidden widgets aren't gone:
 * they drop into the "Hidden" tray at the bottom of the dashboard, one tap from
 * coming back.
 *
 * v1 is client-only (like `usePinnedDocs`). Swap the body for a `home_layouts`
 * table behind the same hook surface if cross-device sync is ever wanted.
 *
 * Reconciliation: stored ids are intersected with the live widget registry, and
 * any newly-added widget (not in stored order) is appended visible — so adding
 * a widget in code surfaces it for everyone without wiping their arrangement.
 */

export type DashboardLayout = {
  /** Widget ids in render order (includes hidden). */
  order: string[];
  /** Widget ids dropped to the Hidden tray. */
  hidden: string[];
};

function storageKey(name: string, propertyId: string, userId: string): string {
  return `hotelclaw:${name}:${propertyId}:${userId}`;
}

function read(
  name: string,
  propertyId: string,
  userId: string,
  allIds: string[],
): DashboardLayout {
  const fallback: DashboardLayout = { order: allIds, hidden: [] };
  try {
    const raw = window.localStorage.getItem(
      storageKey(name, propertyId, userId),
    );
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const known = new Set(allIds);
    const order = (parsed.order ?? []).filter((id) => known.has(id));
    for (const id of allIds) if (!order.includes(id)) order.push(id);
    const hidden = (parsed.hidden ?? []).filter((id) => known.has(id));
    return { order, hidden };
  } catch {
    return fallback;
  }
}

function write(
  name: string,
  propertyId: string,
  userId: string,
  layout: DashboardLayout,
): void {
  try {
    window.localStorage.setItem(
      storageKey(name, propertyId, userId),
      JSON.stringify(layout),
    );
  } catch {
    // ignore quota / disabled storage — the layout just won't persist
  }
}

export type UseDashboardLayout = {
  /** Full widget order, including hidden ones. */
  order: string[];
  /** Visible widget ids, in order (excludes hidden). */
  visible: string[];
  /** Hidden widget ids, in order. */
  hidden: string[];
  /** True once the layout has been read from storage. */
  ready: boolean;
  isHidden: (id: string) => boolean;
  /** Persist a new full order (after a drag). */
  setOrder: (order: string[]) => void;
  /** Hide a widget (to the tray) or bring it back. */
  toggleHidden: (id: string) => void;
  /** Restore the shipped default (all visible, registry order). */
  reset: () => void;
};

export function useDashboardLayout(
  propertyId: string,
  userId: string,
  allIds: string[],
  name = "home-layout",
): UseDashboardLayout {
  // SSR-safe: default on first render, re-read from storage post-hydration.
  const [layout, setLayout] = useState<DashboardLayout>({
    order: allIds,
    hidden: [],
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(read(name, propertyId, userId, allIds));
    setReady(true);
    // allIds is stable per render from the registry; key on the scope only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, propertyId, userId]);

  const commit = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      write(name, propertyId, userId, next);
    },
    [name, propertyId, userId],
  );

  const setOrder = useCallback(
    (order: string[]) => commit({ order, hidden: layout.hidden }),
    [commit, layout.hidden],
  );

  const toggleHidden = useCallback(
    (id: string) =>
      commit({
        order: layout.order,
        hidden: layout.hidden.includes(id)
          ? layout.hidden.filter((x) => x !== id)
          : [...layout.hidden, id],
      }),
    [commit, layout.order, layout.hidden],
  );

  const reset = useCallback(
    () => commit({ order: allIds, hidden: [] }),
    [commit, allIds],
  );

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  const hidden = layout.order.filter((id) => layout.hidden.includes(id));

  return {
    order: layout.order,
    visible,
    hidden,
    ready,
    isHidden: (id) => layout.hidden.includes(id),
    setOrder,
    toggleHidden,
    reset,
  };
}
