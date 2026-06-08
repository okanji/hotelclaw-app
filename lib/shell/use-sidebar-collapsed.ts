"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Deliberate, persisted collapse of the secondary sidebar — distinct from the
 * transient `sidebarHidden` (which a surface like the workflow canvas sets for
 * its own session and which resets on navigation). This one is a user choice:
 * it survives navigation and reloads via localStorage.
 */
const KEY = "hotelclaw:sidebar-collapsed";

export function useSidebarCollapsed() {
  // SSR-safe: default expanded, then read the stored choice after hydration.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(KEY) === "1");
    } catch {
      // private mode / disabled storage — stay expanded
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
