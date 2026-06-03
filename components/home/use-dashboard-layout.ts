"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user, per-property memory of the Home dashboard arrangement — widget
 * order, which widgets are collapsed (header only), and which are hidden
 * entirely — kept in `localStorage`. The dashboard ships a sensible default;
 * this lets each person reorder sections, collapse the ones they want out of
 * the way, and fully remove the ones they don't need, persisted on their
 * device.
 *
 * v1 is client-only (like `usePinnedDocs`). Swap the body for a `home_layouts`
 * table behind the same hook surface if cross-device sync is ever wanted.
 *
 * Reconciliation: stored ids are intersected with the live widget registry, and
 * any newly-added widget (not in stored order) is appended visible + expanded —
 * so adding a widget in code surfaces it for everyone without wiping their
 * arrangement.
 */

const KEY_PREFIX = "hotelclaw:home-layout:";

export type DashboardLayout = {
  /** Widget ids in render order. */
  order: string[];
  /** Widget ids removed from the dashboard (re-add via the Customize menu). */
  hidden: string[];
  /** Widget ids shown collapsed (heading only). */
  collapsed: string[];
};

function storageKey(propertyId: string, userId: string): string {
  return `${KEY_PREFIX}${propertyId}:${userId}`;
}

function read(
  propertyId: string,
  userId: string,
  allIds: string[],
): DashboardLayout {
  const fallback: DashboardLayout = {
    order: allIds,
    hidden: [],
    collapsed: [],
  };
  try {
    const raw = window.localStorage.getItem(storageKey(propertyId, userId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const known = new Set(allIds);
    const order = (parsed.order ?? []).filter((id) => known.has(id));
    for (const id of allIds) if (!order.includes(id)) order.push(id);
    const hidden = (parsed.hidden ?? []).filter((id) => known.has(id));
    const collapsed = (parsed.collapsed ?? []).filter((id) => known.has(id));
    return { order, hidden, collapsed };
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
  /** Full widget order, including hidden ones. */
  order: string[];
  /** Visible widget ids, in order (excludes hidden). */
  visible: string[];
  /** True once the layout has been read from storage. */
  ready: boolean;
  isHidden: (id: string) => boolean;
  isCollapsed: (id: string) => boolean;
  /** Persist a new full order (after a drag). */
  setOrder: (order: string[]) => void;
  /** Add or remove a widget from the dashboard entirely. */
  toggleHidden: (id: string) => void;
  /** Collapse or expand a widget's body. */
  toggleCollapsed: (id: string) => void;
  /** Restore the shipped default (all visible, expanded, registry order). */
  reset: () => void;
};

export function useDashboardLayout(
  propertyId: string,
  userId: string,
  allIds: string[],
): UseDashboardLayout {
  // SSR-safe: default on first render, re-read from storage post-hydration.
  const [layout, setLayout] = useState<DashboardLayout>({
    order: allIds,
    hidden: [],
    collapsed: [],
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(read(propertyId, userId, allIds));
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
    (order: string[]) => commit({ ...layout, order }),
    [commit, layout],
  );

  const toggleHidden = useCallback(
    (id: string) =>
      commit({
        ...layout,
        hidden: layout.hidden.includes(id)
          ? layout.hidden.filter((x) => x !== id)
          : [...layout.hidden, id],
      }),
    [commit, layout],
  );

  const toggleCollapsed = useCallback(
    (id: string) =>
      commit({
        ...layout,
        collapsed: layout.collapsed.includes(id)
          ? layout.collapsed.filter((x) => x !== id)
          : [...layout.collapsed, id],
      }),
    [commit, layout],
  );

  const reset = useCallback(
    () => commit({ order: allIds, hidden: [], collapsed: [] }),
    [commit, allIds],
  );

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  return {
    order: layout.order,
    visible,
    ready,
    isHidden: (id) => layout.hidden.includes(id),
    isCollapsed: (id) => layout.collapsed.includes(id),
    setOrder,
    toggleHidden,
    toggleCollapsed,
    reset,
  };
}
