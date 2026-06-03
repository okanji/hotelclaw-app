"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user, per-property memory of the Home dashboard arrangement — widget
 * order + which widgets are hidden — kept in `localStorage`. The dashboard
 * ships a sensible default; this lets each person reorder cards and hide the
 * ones they don't care about, and have it stick on their device.
 *
 * v1 is client-only (like `usePinnedDocs`): the layout lives on this device and
 * doesn't sync. Swap the body for a `home_layouts` table behind the same hook
 * surface if cross-device sync is ever wanted.
 *
 * Reconciliation: stored ids are intersected with the live widget registry, and
 * any newly-added widget (not in stored order) is appended visible — so adding
 * a widget in code surfaces it for everyone without wiping their arrangement.
 */

const KEY_PREFIX = "hotelclaw:home-layout:";

export type DashboardLayout = {
  /** Widget ids in render order. */
  order: string[];
  /** Widget ids the user has hidden. */
  hidden: string[];
};

function storageKey(propertyId: string, userId: string): string {
  return `${KEY_PREFIX}${propertyId}:${userId}`;
}

function read(
  propertyId: string,
  userId: string,
  allIds: string[],
): DashboardLayout {
  const fallback: DashboardLayout = { order: allIds, hidden: [] };
  try {
    const raw = window.localStorage.getItem(storageKey(propertyId, userId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const known = new Set(allIds);
    const order = (parsed.order ?? []).filter((id) => known.has(id));
    // Append any widgets added since the layout was saved.
    for (const id of allIds) if (!order.includes(id)) order.push(id);
    const hidden = (parsed.hidden ?? []).filter((id) => known.has(id));
    return { order, hidden };
  } catch {
    return fallback;
  }
}

function write(
  propertyId: string,
  userId: string,
  layout: DashboardLayout,
): void {
  try {
    window.localStorage.setItem(
      storageKey(propertyId, userId),
      JSON.stringify(layout),
    );
  } catch {
    // ignore quota / disabled storage — the layout just won't persist
  }
}

export type UseDashboardLayout = {
  /** Visible widget ids, in order. */
  visible: string[];
  /** True once the layout has been read from storage (avoids a reorder flash). */
  ready: boolean;
  isHidden: (id: string) => boolean;
  /** Persist a new full order (after a drag). */
  setOrder: (order: string[]) => void;
  /** Show or hide a widget. */
  toggle: (id: string) => void;
  /** Restore the shipped default (all visible, registry order). */
  reset: () => void;
};

export function useDashboardLayout(
  propertyId: string,
  userId: string,
  allIds: string[],
): UseDashboardLayout {
  // SSR-safe: default order on first render, re-read from storage post-hydration
  // (reading localStorage during render would diverge server vs client).
  const [layout, setLayout] = useState<DashboardLayout>({
    order: allIds,
    hidden: [],
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(read(propertyId, userId, allIds));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    // allIds is stable per render from the registry; key on the scope only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, userId]);

  const commit = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      write(propertyId, userId, next);
    },
    [propertyId, userId],
  );

  const setOrder = useCallback(
    (order: string[]) => commit({ order, hidden: layout.hidden }),
    [commit, layout.hidden],
  );

  const toggle = useCallback(
    (id: string) => {
      const hidden = layout.hidden.includes(id)
        ? layout.hidden.filter((x) => x !== id)
        : [...layout.hidden, id];
      commit({ order: layout.order, hidden });
    },
    [commit, layout],
  );

  const reset = useCallback(
    () => commit({ order: allIds, hidden: [] }),
    [commit, allIds],
  );

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  return {
    visible,
    ready,
    isHidden: (id) => layout.hidden.includes(id),
    setOrder,
    toggle,
    reset,
  };
}
